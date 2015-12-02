define(function (require) {
  'use strict';

  var co = require('co');
  var { shallowClone } = require('../../util');
  var { prioritizeNewer } = require('../../date_priority_adjuster');

  var TaskDefiner = require('../../task_infra/task_definer');

  var { resolveConversationTaskHelper } = require('../../tasks/mix_conv_resolver');

  var { chewMessageStructure } = require('../imapchew');

  var { conversationMessageComparator } = require('../../db/comparators');

  var churnConversation = require('../../churn_drivers/conv_churn_driver');

  /**
   * What to fetch.  Note that we currently re-fetch the flags even though they're
   * provided as an argument to our task.  We shouldn't, but this is handy for
   * debugging right now and may end up being conditionally necessary in the
   * smarter CONDSTORE/QRESYNC cases.
   */
  var INITIAL_FETCH_PARAMS = ['uid', 'internaldate', 'bodystructure', 'flags', 'BODY.PEEK[' + 'HEADER.FIELDS ' + '(FROM TO CC BCC SUBJECT REPLY-TO MESSAGE-ID REFERENCES IN-REPLY-TO)]'];

  /**
   * @typedef {Object} SyncConvTaskArgs
   * @prop accountId
   * @prop folderId
   * @prop uid
   * @prop umid
   * @prop dateTS
   * @prop flags
   **/

  /**
   * Fetch the envelope for a message so we have enough info to create the message
   * and to also thread the message into a conversation.  We create or update the
   * conversation during this process.
   */
  return TaskDefiner.defineSimpleTask([{
    name: 'sync_message',

    plan: co.wrap(function* (ctx, rawTask) {
      var plannedTask = shallowClone(rawTask);

      // We don't have any a priori name-able exclusive resources.  Our records
      // are either orthogonal or will only be dynamically discovered while
      // we're running.
      plannedTask.exclusiveResources = [];

      plannedTask.priorityTags = [];

      // Prioritize the message based on how new it is.
      if (rawTask.dateTS) {
        plannedTask.relPriority = prioritizeNewer(rawTask.dateTS);
      }

      yield ctx.finishTask({
        taskState: plannedTask
      });
    }),

    execute: co.wrap(function* (ctx, req) {
      // -- Get the envelope
      var account = yield ctx.universe.acquireAccount(ctx, req.accountId);
      var folderInfo = account.getFolderById(req.folderId);

      var { result: rawMessages } = yield account.pimap.listMessages(folderInfo, [req.uid], INITIAL_FETCH_PARAMS, { byUid: true });
      var msg = rawMessages[0];

      // -- Resolve the conversation this goes in.
      var { convId, existingConv, messageId, headerIdWrites, extraTasks } = yield* resolveConversationTaskHelper(ctx, msg, req.accountId, req.umid);

      var messageInfo = chewMessageStructure(msg, [req.folderId], msg.flags, convId, req.umid, messageId);

      // -- If the conversation existed, load it for re-churning
      var oldConvInfo = undefined;
      var allMessages = undefined;
      var newConversations = undefined,
          modifiedConversations = undefined;
      if (existingConv) {
        var fromDb = yield ctx.beginMutate({
          conversations: new Map([[convId, null]]),
          messagesByConversation: new Map([[convId, null]])
        });

        oldConvInfo = fromDb.conversations.get(convId);
        var existingMessages = fromDb.messagesByConversation.get(convId);
        allMessages = existingMessages.concat([messageInfo]);
        allMessages.sort(conversationMessageComparator);
      } else {
        oldConvInfo = null;
        allMessages = [messageInfo];
      }

      var convInfo = churnConversation(convId, oldConvInfo, allMessages);

      if (existingConv) {
        modifiedConversations = new Map([[convId, convInfo]]);
      } else {
        newConversations = [convInfo];
      }

      yield ctx.finishTask({
        mutations: {
          conversations: modifiedConversations,
          headerIdMaps: headerIdWrites,
          umidNames: new Map([[req.umid, messageId]])
        },
        newData: {
          conversations: newConversations,
          messages: [messageInfo],
          tasks: extraTasks
        }
      });
    })
  }]);
});
