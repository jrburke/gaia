define(function (require) {
  'use strict';

  const co = require('co');

  const TaskDefiner = require('../../task_infra/task_definer');

  const FolderSyncStateHelper = require('../folder_sync_state_helper');

  const churnConversation = require('../../churn_drivers/conv_churn_driver');

  const { processMessageContent } = require('../../bodies/mailchew');

  const downloadBody = require('../smotocol/download_body');
  const downloadBody25 = require('../smotocol/download_body_25');

  const { Enums: asbEnum } = require('activesync/codepages/AirSyncBase');

  const { MAX_SNIPPET_BYTES } = require('../../syncbase');

  /**
   * The desired number of bytes to fetch when downloading bodies, but the body's
   * size exceeds the maximum requested size.
   */
  const DESIRED_TEXT_SNIPPET_BYTES = 512;

  /**
   * A custom execute() implementation building on top of Vanilla IMAP's sync_body
   * plan() implementation and general implementation strategy.
   *
   * The primary differences we run into that make us deviate enough that this is
   * a good idea:
   * - For ActiveSync there's only ever one body part, at least as currently
   *   implemented.  There are some nightmares on the horizon.
   * - We have a different protocol request for 2.5 versus 12.0+ versions, and
   *   the flipping 2.5 version needs the syncKey which means it needs to access
   *   the FolderSyncState too.  It's not so bad that we need to mark 2.5 with
   *   a different engine, but it's certainly frustrating.
   */
  return TaskDefiner.defineComplexTask([require('../../task_mixins/mix_sync_body'), {
    execute: co.wrap(function* (ctx, persistentState, memoryState, marker) {
      var req = memoryState.get(marker.convId);

      // -- Acquire the account and establish a connection
      // We need the protcol version to know whether our mutation request needs
      // the folder sync state or not.
      var account = yield ctx.universe.acquireAccount(ctx, marker.accountId);
      var conn = yield account.ensureConnection();
      var use25 = conn.currentVersion.lt('12.0');

      // -- Retrieve the conversation and its messages for mutation
      var fromDb = yield ctx.beginMutate({
        conversations: new Map([[req.convId, null]]),
        messagesByConversation: new Map([[req.convId, null]])
      });

      var oldConvInfo = fromDb.conversations.get(req.convId);
      var loadedMessages = fromDb.messagesByConversation.get(req.convId);
      var modifiedMessagesMap = new Map();

      // -- Get the message locations
      var umidLocations = new Map();
      for (var message of loadedMessages) {
        umidLocations.set(message.umid, null);
      }

      // We need to look up all the umidLocations.
      yield ctx.read({
        umidLocations
      });

      // -- Get the folder sync states
      // XXX this is all 2.5 stuff, we can avoid it for 12.0+ but until we have
      // unit tests, it's safest to leave this code active so it's clear it's
      // not broken.  This just ends up as a wasteful no-op.
      var rawSyncStateReads = new Map();
      for (var [folderId] of umidLocations.values()) {
        rawSyncStateReads.set(folderId, null);
      }
      yield ctx.mutateMore({
        syncStates: rawSyncStateReads
      });

      var syncStates = new Map();
      for (var [folderId, rawSyncState] of rawSyncStateReads) {
        syncStates.set(folderId, new FolderSyncStateHelper(ctx, rawSyncState, marker.accountId, folderId));
      }

      // Determine our byte budget for each message.  If omitted, we fetch the
      // whole thing.
      var truncationSize = 0;
      if (req.amount === 'snippet') {
        truncationSize = MAX_SNIPPET_BYTES;
      } else if (req.amount) {
        truncationSize = req.amount;
      }

      // -- For each message...
      for (var message of loadedMessages) {
        var [folderId, messageServerId] = umidLocations.get(message.umid);
        var folderInfo = account.getFolderById(folderId);
        var folderServerId = folderInfo.serverId;
        var syncState = syncStates.get(folderId);

        // ActiveSync only stores one body rep, no matter how many body parts
        // the MIME message actually has.
        var bodyRep = message.bodyReps[0];
        var bodyType = bodyRep.type;

        // If we're truncating (and therefore this is a snippet request), and
        // the truncating will actually work, then switch over to plaintext
        // mode and just get enough for a snippet.
        // TODO: normalize/improve this in the context of the above.  I'm doing
        // this for consistency with pre-convoy, but since this refactor is
        // straightening out the control flow, this might not be needed.
        var snippetOnly = false;
        if (truncationSize && truncationSize < bodyRep.sizeEstimate) {
          snippetOnly = true;
          if (!use25) {
            bodyType = 'plain';
            truncationSize = DESIRED_TEXT_SNIPPET_BYTES;
          }
        }
        var asBodyType = bodyType === 'html' ? asbEnum.Type.HTML : asbEnum.Type.PlainText;

        // - Issue the fetch
        var bodyContent = undefined;
        if (use25) {
          // the destructuring assignment expression into existing variables
          // really annoys jshint (known bug), so I'm doing things manually for
          // now.
          var result = yield* downloadBody25(conn, {
            folderSyncKey: syncState.syncKey,
            folderServerId,
            messageServerId,
            bodyType: asBodyType
          });
          bodyContent = result.bodyContent;
          syncState.syncKey = result.syncKey;
        } else {
          bodyContent = (yield* downloadBody(conn, {
            folderServerId,
            messageServerId,
            bodyType: asBodyType,
            truncationSize
          })).bodyContent;
        }

        // - Update the message
        // We neither need to store or want to deal with \r in the processing of
        // the body. XXX this changes with mcav's streaming fixes.
        bodyContent = bodyContent.replace(/\r/g, '');

        var { contentBlob, snippet } = processMessageContent(bodyContent, bodyType, !snippetOnly, // isDownloaded
        true // generateSnippet
        );

        message.snippet = snippet;
        if (!snippetOnly) {
          bodyRep.contentBlob = contentBlob;
          bodyRep.isDownloaded = true;
        }

        modifiedMessagesMap.set(message.id, message);
      }

      // -- Update the conversation
      var convInfo = churnConversation(req.convId, oldConvInfo, loadedMessages);

      // since we're successful at this point, clear it out of the memory state.
      // TODO: parallelizing: see notes in mix_sync_body's execute or just
      // steal its implementation if the todo is gone.
      memoryState.delete(req.convId);

      yield ctx.finishTask({
        mutations: {
          conversations: new Map([[req.convId, convInfo]]),
          messages: modifiedMessagesMap,
          // We don't actually want new sync states created if they don't
          // exist, so just giving back what we've mutated in-place is fine, if
          // bad hygiene.
          syncStates: rawSyncStateReads
        }
      });
    })
  }]);
});
