define(function (require) {
  'use strict';

  const co = require('co');

  const TaskDefiner = require('../task_infra/task_definer');
  const churnConversation = require('../churn_drivers/conv_churn_driver');

  const { convIdFromMessageId } = require('../id_conversions');

  /**
   * Per-account task to delete the draft without any type of undo mechanism.
   * TODO: Any type of undo mechanism ;)
   *
   * This is quite simple right now.  We just load the conversation, re-chew it,
   * and save the modified conversation with the message deleted.
   */
  return TaskDefiner.defineSimpleTask([{
    name: 'draft_delete',

    plan: co.wrap(function* (ctx, req) {
      var { messageId } = req;
      var convId = convIdFromMessageId(messageId);
      var fromDb = yield ctx.beginMutate({
        conversations: new Map([[convId, null]]),
        messagesByConversation: new Map([[convId, null]])
      });

      var messages = fromDb.messagesByConversation.get(convId);
      var modifiedMessagesMap = new Map();

      var draftIndex = messages.findIndex(function (msg) {
        return msg.id === messageId;
      });
      if (draftIndex === -1) {
        throw new Error('moot');
      }
      messages.splice(draftIndex, 1);

      modifiedMessagesMap.set(messageId, null);

      var modifiedConversations = new Map();

      if (messages.length) {
        var oldConvInfo = fromDb.conversations.get(req.convId);
        var convInfo = churnConversation(convId, oldConvInfo, messages);
        modifiedConversations.set(convId, convInfo);
      } else {
        modifiedConversations.set(convId, null);
      }

      yield ctx.finishTask({
        mutations: {
          conversations: modifiedConversations,
          messages: modifiedMessagesMap
        }
      });
    }),

    execute: null
  }]);
});
