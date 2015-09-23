define(function (require) {
  'use strict';

  const logic = require('logic');

  const appChurnConversation = require('app_logic/conv_churn');

  const scope = {};
  logic.defineScope(scope, 'churnConversationDriver');

  /**
   * Produces the wire representation for a conversation from the list of messages
   * that comprise that conversation.  This implementation derives all of the
   * must-have information required for the `MailConversation`.  However,
   * everything else is farmed out to the function provided by the app-logic at
   * "app_logic/conv_churn" and which will be found under "app" on the produced
   * structure.
   */
  return function churnConversationDriver(convId, oldConvInfo, messages) {
    var authorsByEmail = new Map();
    // The number of headers where we have already fetch snippets (or at least
    // tried to).
    var snippetCount = 0;
    var tidbits = [];
    var convHasUnread = false;
    var convHasStarred = false;
    var convHasDrafts = false;
    var convHasAttachments = false;
    var convFolderIds = new Set();
    // At least for now, the effective date is the most recent non-draft message.
    var effectiveDate = 0;
    var fallbackDate = 0;
    for (var message of messages) {
      var isRead = message.flags.indexOf('\\Seen') !== -1;
      var isStarred = message.flags.indexOf('\\Flagged') !== -1;
      var isDraft = message.draftInfo !== null;

      fallbackDate = Math.max(fallbackDate, message.date);
      if (isDraft) {
        convHasDrafts = true;
      } else {
        effectiveDate = Math.max(effectiveDate, message.date);
      }

      if (!isRead) {
        convHasUnread = true;
      }
      if (isStarred) {
        convHasStarred = true;
      }
      if (message.hasAttachments) {
        convHasAttachments = true;
      }

      if (!authorsByEmail.has(message.author.address)) {
        authorsByEmail.set(message.author.address, message.author);
      }

      // union this messages's folderId's into the conversation's.
      for (var folderId of message.folderIds) {
        convFolderIds.add(folderId);
      }

      if (message.snippet !== null) {
        snippetCount++;
      }
    }

    if (!effectiveDate) {
      effectiveDate = fallbackDate;
    }

    var convInfo = {
      id: convId,
      date: effectiveDate,
      folderIds: convFolderIds,
      // It's up to the actual churn to clobber the height if it wants.
      height: 1,
      subject: messages[0].subject,
      messageCount: messages.length,
      snippetCount: snippetCount,
      authors: Array.from(authorsByEmail.values()),
      tidbits: tidbits,
      hasUnread: convHasUnread,
      hasStarred: convHasStarred,
      hasDrafts: convHasDrafts,
      hasAttachments: convHasAttachments,
      app: {}
    };

    try {
      appChurnConversation(convInfo, messages, oldConvInfo);
    } catch (ex) {
      logic(scope, 'appChurnEx', { ex });
    }

    return convInfo;
  };
});
