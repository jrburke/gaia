define(function (require) {
  'use strict';

  const co = require('co');
  const logic = require('logic');

  const TaskDefiner = require('../task_infra/task_definer');
  const churnConversation = require('../churn_drivers/conv_churn_driver');

  const { convIdFromMessageId } = require('../id_conversions');

  const { DESIRED_SNIPPET_LENGTH } = require('../syncbase');

  const { quoteProcessTextBody, generateSnippet } = require('../bodies/quotechew');

  /**
   * Per-account task to update the non-attachment parts of an existing draft.
   *
   * This is quite simple right now.  We just load the conversation, re-chew it,
   * and save the modified conversation and message.
   */
  return TaskDefiner.defineSimpleTask([{
    name: 'draft_save',

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
      var draftFields = req.draftFields;
      messageInfo.date = draftFields.date;
      messageInfo.to = draftFields.to;
      messageInfo.cc = draftFields.cc;
      messageInfo.bcc = draftFields.bcc;
      messageInfo.subject = draftFields.subject;
      // - Update the body rep
      var textRep = messageInfo.bodyReps.find(function (rep) {
        return rep.type === 'plain';
      });
      textRep.contentBlob = new Blob([JSON.stringify([0x1, draftFields.textBody])], { type: 'application/json' });

      // - Update the snippet
      // Even though we currently store the draft body in a single block rather
      // than a fully quote-chewed representation, for snippet generation
      // purposes, it makes sense to run a quotechew pass.
      try {
        var parsedContent = quoteProcessTextBody(draftFields.textBody);
        messageInfo.snippet = generateSnippet(parsedContent, DESIRED_SNIPPET_LENGTH);
      } catch (ex) {
        // We don't except this to throw, but if it does, that is something we
        // want to break our unit tests.
        logic.fail(ex);
      }

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
