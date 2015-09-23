define(function() {
'use strict';

/**
 * How many tidbits should we cram in a conversation summary?
 */
const MAX_TIDBITS = 1;

/**
 * Produce a conversationInfo summary given all of the currently existing
 * headers in the conversation ordered from oldest to newest.
 */
return function churnConversation(convInfo, messages/*, oldConvInfo */) {
  var tidbits = convInfo.app.tidbits = [];

  for (var message of messages) {
    var isRead = message.flags.indexOf('\\Seen') !== -1;

    // Add up to MAX_TIDBITS tidbits for unread messages
    if (!isRead) {
      var isStarred = message.flags.indexOf('\\Flagged') !== -1;
      tidbits.push({
        id: message.id,
        date: message.date,
        isRead: isRead,
        isStarred: isStarred,
        hasAttachments: message.hasAttachments,
        author: message.author,
        snippet: message.snippet
      });
      if (tidbits.length >= MAX_TIDBITS) {
        break;
      }
    }
  }
};

});
