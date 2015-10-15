define(function (require) {
  'use strict';

  const co = require('co');

  const { BLOB_BASE64_BATCH_CONVERT_SIZE } = require('../syncbase');

  const TaskDefiner = require('../task_infra/task_definer');
  const churnConversation = require('../churn_drivers/conv_churn_driver');

  const { makeAttachmentPart } = require('../db/mail_rep');
  const { mimeStyleBase64Encode } = require('safe-base64');
  const asyncFetchBlob = require('../async_blob_fetcher');

  const { convIdFromMessageId } = require('../id_conversions');

  /**
   * Per-account task to incrementally convert an attachment into its base64
   * encoded attachment form which we save in chunks to IndexedDB to avoid using
   * too much memory now or during the sending process.
   *
   * - Retrieve the body the draft is persisted to,
   * - Repeat until the attachment is fully attached:
   *   - take a chunk of the source attachment
   *   - base64 encode it into a Blob by creating a Uint8Array and manually
   *     encoding into that.  (We need to put a \r\n after every 76 bytes, and
   *     doing that using window.btoa is going to create a lot of garbage. And
   *     addressing that is no longer premature optimization.)
   *   - update the message with that Blob
   *   - write the updated message
   *   - force the message to be discarded from the cache and re-fetched.
   *     We won't be saving any memory until the Blob has been written to
   *     disk and we have forgotten all references to the in-memory Blob we wrote
   *     to the database.  (The Blob does not magically get turned into a
   *     reference to the database yet.  That's bug
   *     https://bugzilla.mozilla.org/show_bug.cgi?id=1192115)
   * - Be done.  Note that we leave the "small" Blobs independent; we do not
   *   create a super Blob.
   *
   * Eventually this task will likely be mooted by us just storing the Blobs we
   * want to send fully intact and performing encoding on-demand on the way out.
   *
   * Implementation note:
   */
  return TaskDefiner.defineSimpleTask([{
    name: 'draft_attach',

    plan: co.wrap(function* (ctx, req) {
      var { messageId } = req;
      var convId = convIdFromMessageId(messageId);
      var fromDb = yield ctx.beginMutate({
        conversations: new Map([[convId, null]]),
        messagesByConversation: new Map([[convId, null]])
      });

      var messages = fromDb.messagesByConversation.get(convId);
      var modifiedMessagesMap = new Map();

      var messageInfo = messages.find(function (msg) {
        return msg.id === messageId;
      });
      if (messageInfo === null) {
        throw new Error('moot');
      }
      var messageKey = [messageInfo.id, messageInfo.date];

      // -- Prep message rep
      const attachmentDef = req.attachmentDef;
      const wholeBlob = attachmentDef.blob;
      messageInfo.attaching = makeAttachmentPart({
        relId: attachmentDef.relId,
        name: attachmentDef.name,
        type: wholeBlob.type,
        sizeEstimate: wholeBlob.size,
        // this is where we put the Blob segments...
        file: []
      });
      // -- Encode loop.
      var blobOffset = 0;
      while (blobOffset < wholeBlob.size) {
        var nextOffset = Math.min(wholeBlob.size, blobOffset + BLOB_BASE64_BATCH_CONVERT_SIZE);
        console.log('attachBlobToDraft: fetching', blobOffset, 'to', nextOffset, 'of', wholeBlob.size);

        var slicedBlob = wholeBlob.slice(blobOffset, nextOffset);
        blobOffset = nextOffset;

        var arraybuffer = yield asyncFetchBlob(slicedBlob, 'arraybuffer');
        var binaryDataU8 = new Uint8Array(arraybuffer);
        var encodedU8 = mimeStyleBase64Encode(binaryDataU8);
        messageInfo.attaching.file.push(new Blob([encodedU8], { type: wholeBlob.type }));
        // (in the v1.x job-op we'd do the finalization and transition from
        // attaching to attachments in this final pass here, but since we need
        // to issue an additional write anyways, we do that outside the loop.)

        // - Issue the incremental write
        yield ctx.dangerousIncrementalWrite({
          messages: new Map([[messageId, messageInfo]])
        });

        // - Read back the Blob for memory usage reasons.
        var flushedReads = yield ctx.mutateMore({
          flushedMessageReads: true,
          messages: new Map([[messageKey, null]])
        });

        messageInfo = flushedReads.messages.get(messageId);
      }

      // -- Finalize the attachment
      messageInfo.hasAttachments = true;
      messageInfo.attachments.push(messageInfo.attaching);
      delete messageInfo.attaching; // bad news for shapes, but drafts are rare.

      modifiedMessagesMap.set(messageId, messageInfo);

      // -- Churn the conversation
      var oldConvInfo = fromDb.conversations.get(req.convId);
      var convInfo = churnConversation(convId, oldConvInfo, messages);

      // -- Victory!
      yield ctx.finishTask({
        mutations: {
          conversations: new Map([[convId, convInfo]]),
          messages: modifiedMessagesMap
        }
      });
    }),

    execute: null
  }]);
});
