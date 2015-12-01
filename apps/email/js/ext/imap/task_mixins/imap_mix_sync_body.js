define(function (require) {
  'use strict';

  var co = require('co');

  var imapchew = require('../imapchew');

  var churnConversation = require('../../churn_drivers/conv_churn_driver');

  var { SnippetParser } = require('../protocol/snippetparser');
  var { TextParser } = require('../protocol/textparser');

  var asyncFetchBlob = require('../../async_blob_fetcher');

  const { MAX_SNIPPET_BYTES } = require('../../syncbase');

  /**
   * Maximum bytes to request from server in a fetch request (max uint32)
   */
  const MAX_FETCH_BYTES = Math.pow(2, 32) - 1;

  return {
    execute: co.wrap(function* (ctx, persistentState, memoryState, marker) {
      var req = memoryState.get(marker.convId);

      // -- Retrieve the conversation and its messages for mutation
      var fromDb = yield ctx.beginMutate({
        conversations: new Map([[req.convId, null]]),
        messagesByConversation: new Map([[req.convId, null]])
      });

      var loadedMessages = fromDb.messagesByConversation.get(req.convId);
      var modifiedMessagesMap = new Map();

      var account = yield ctx.universe.acquireAccount(ctx, marker.accountId);

      var prepared = yield this.prepForMessages(ctx, account, loadedMessages);

      // Determine our byte budget for each message.  A zero budget means that
      // for fullBodyMessageIds-listed messages we will download them in their
      // entirety and do nothing else for the other messages.
      var maxBytesPerMessage = 0;
      if (req.amount === 'snippet') {
        maxBytesPerMessage = MAX_SNIPPET_BYTES;
      } else if (req.amount) {
        maxBytesPerMessage = req.amount;
      }

      // -- For each message...
      for (var message of loadedMessages) {
        var remainingByteBudget = maxBytesPerMessage;
        // If this message isn't explicitly opted-in and we have no snippety
        // budget, then skip this message.
        if (!remainingByteBudget && (!req.fullBodyMessageIds || !req.fullBodyMessageIds.has(message.id))) {
          continue;
        }
        var bodyRepIndex = imapchew.selectSnippetBodyRep(message);

        // -- For each body part...
        for (var iBodyRep = 0; iBodyRep < message.bodyReps.length; iBodyRep++) {
          var rep = message.bodyReps[iBodyRep];
          // - Figure out what work, if any, to do.
          if (rep.isDownloaded) {
            continue;
          }

          // default to the entire remaining email. We use the estimate *
          // largish multiplier so even if the size estimate is wrong we should
          // fetch more then the requested number of bytes which if truncated
          // indicates the end of the bodies content.
          var bytesToFetch = Math.min(rep.sizeEstimate * 5, MAX_FETCH_BYTES);

          var bodyParser = undefined;
          var partDef = rep._partInfo;
          if (maxBytesPerMessage) {
            // issued enough downloads
            if (remainingByteBudget <= 0) {
              break;
            }

            // if our estimate is greater then expected number of bytes
            // request the maximum allowed.
            if (rep.sizeEstimate > remainingByteBudget) {
              bytesToFetch = remainingByteBudget;
            }
            // subtract the estimated byte size
            remainingByteBudget -= rep.sizeEstimate;

            bodyParser = new SnippetParser(partDef);
          } else {
            bodyParser = new TextParser(partDef);
          }

          // For a byte-serve request, we need to request at least 1 byte, so
          // request some bytes.  This is a logic simplification that should not
          // need to be used because imapchew.js should declare 0-byte files
          // fully downloaded when their parts are created, but better a
          // wasteful network request than breaking here.
          if (bytesToFetch <= 0) {
            bytesToFetch = 64;
          }

          var byteRange = undefined;
          if (maxBytesPerMessage || rep.amountDownloaded) {
            byteRange = {
              offset: rep.amountDownloaded,
              bytesToFetch
            };
          }

          // If we had already downloaded part of the body, be sure to parse it.
          // It is stored out-of-line as a Blob, so must be (asynchronously)
          // fetched.
          if (partDef.pendingBuffer) {
            var loadedBuffer = new Uint8Array((yield asyncFetchBlob(partDef.pendingBuffer, 'arraybuffer')));
            bodyParser.parse(loadedBuffer);
          }

          // - Issue the fetch
          var { folderInfo, uid } = this.getFolderAndUidForMesssage(prepared, account, message);
          var rawBody = yield account.pimap.fetchBody(ctx, folderInfo, {
            uid,
            part: rep.part,
            byteRange
          });

          bodyParser.parse(rawBody);
          var bodyResult = bodyParser.complete();

          // - Update the message
          imapchew.updateMessageWithFetch(message, {
            bodyRepIndex: iBodyRep,
            createSnippet: iBodyRep === bodyRepIndex,
            byteRange
          }, bodyResult);

          modifiedMessagesMap.set(message.id, message);
        }
      }

      // -- Update the conversation
      var convInfo = churnConversation(req.convId, null, loadedMessages);

      // since we're successful at this point, clear it out of the memory state.
      // TODO: when parallelizing, move this up the top and use it at the same
      // time as ctx.setFailureTasks in order to implement proper recovery
      // semantics.  (Although, honestly, sync_body is an inherently idempotent
      // sort of thing where the front-end is likely to re-issue requests, so
      // it's not the end of the world if we lose the request.)
      memoryState.delete(req.convId);

      yield ctx.finishTask({
        mutations: {
          conversations: new Map([[req.convId, convInfo]]),
          messages: modifiedMessagesMap
        }
      });
    })
  };
});
