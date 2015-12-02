define(function (require) {
  'use strict';

  const co = require('co');

  const TaskDefiner = require('../../task_infra/task_definer');

  const churnConversation = require('../../churn_drivers/conv_churn_driver');

  /**
   * A custom execute() implementation building on top of Vanilla IMAP's sync_body
   * plan() implementation and general implementation strategy.
   *
   * Our rationale is similar to ActiveSync's where we adopt the same
   * custom-execute strategy:
   * - We're just downloading stuff in a single go since we have no concept of
   *   bodystructure, so the part logic doesn't matter to us.
   * - We have to deal with the side-effects of that, spawning attachments to be
   *   separate things.
   *
   * Note that there is a resource-usage concern to our adoption of this
   * conversation-centric transaction strategy since we're potentially downloading
   * a serious amount of information per-message.  This is potentially mitigated
   * by UI access patterns if the UI only shows one message at a time (ex: gaia
   * mail).  The integration of mcav's streaming changes should help eliminate
   * this as an issue.
   *
   * NOTE: We are emergently only used for body downloading.  This is because
   * sync_message already downloads snippets for messages as their envelopes are
   * fetched.  So no-one will try and use us for snippets.  If they do, we'll
   * end up downloading the entirety of the message, which could be bad.
   */
  return TaskDefiner.defineComplexTask([require('../../task_mixins/mix_sync_body'), {
    execute: co.wrap(function* (ctx, persistentState, memoryState, marker) {
      var req = memoryState.get(marker.convId);

      // -- Acquire the account and establish a connection
      var account = yield ctx.universe.acquireAccount(ctx, marker.accountId);
      var popAccount = account.popAccount;
      var conn = yield popAccount.ensureConnection();

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

      // -- Make sure the UIDL mapping is active
      yield conn.loadMessageList(); // we don't care about the return value.

      // -- For each message...
      for (var message of loadedMessages) {
        // If this message isn't explicitly opted-in, skip it.
        if (!req.fullBodyMessageIds || !req.fullBodyMessageIds.has(message.id)) {
          continue;
        }

        var uidl = umidLocations.get(message.umid);
        var messageNumber = conn.uidlToId[uidl];

        var newMessageInfo = yield conn.downloadMessageByNumber(messageNumber);

        // Propagate the things that can change across.  Which is all to do with
        // body parts and things derived from body parts.
        message.hasAttachments = newMessageInfo.hasAttachments;
        message.snippet = newMessageInfo.snippet;
        message.attachments = newMessageInfo.attachments;
        message.relatedParts = newMessageInfo.relatedParts;
        message.bodyReps = newMessageInfo.bodyReps;
        message.bytesToDownloadForBodyDisplay = 0;

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
          messages: modifiedMessagesMap
        }
      });
    })
  }]);
});
