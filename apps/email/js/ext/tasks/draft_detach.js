define(function (require) {
  'use strict';

  const co = require('co');

  const TaskDefiner = require('../task_infra/task_definer');
  const churnConversation = require('../churn_drivers/conv_churn_driver');

  const { convIdFromMessageId } = require('../id_conversions');

  /**
   * Per-account task to remove an attachment from a draft.  This is trivial and
   * very similar to saving a draft, so will likely be consolidated.
   */
  return TaskDefiner.defineSimpleTask([{
    name: 'draft_detach',

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

      // -- Update the message.
      var attachmentIndex = messageInfo.attachments.findIndex(function (att) {
        return att.relId === req.attachmentRelId;
      });
      if (attachmentIndex === -1) {
        throw new Error('moot');
      }
      messageInfo.attachments.splice(attachmentIndex, 1);
      messageInfo.hasAttachments = messageInfo.attachments.length > 0;
      modifiedMessagesMap.set(messageId, messageInfo);

      var oldConvInfo = fromDb.conversations.get(req.convId);
      var convInfo = churnConversation(convId, oldConvInfo, messages);

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
