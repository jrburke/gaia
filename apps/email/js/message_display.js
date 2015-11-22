'use strict';

/**
 * Helpers for displaying information about email messages.
 */
define(function(require) {
  var mozL10n = require('l10n!');

  return {
    /**
     * Format the message subject appropriately.  This means ensuring that
     * if the subject is empty, we use a placeholder string instead.
     *
     * @param {DOMElement} subjectNode the DOM node for the message's
     * subject.
     * @param {Object} [message] the message object. If this is a falsey value,
     * then it just indicates the subject should be cleared, empty display.
     */
    subject: function(subjectNode, message) {
      var subject = message && (message.firstSubject || message.subject);

      // No message object means
      if (!message || subject) {
        subject = subject ? subject.trim() : '';
        subjectNode.textContent = subject;
        subjectNode.classList.remove('msg-no-subject');
        subjectNode.removeAttribute('data-l10n-id');
      } else {
        mozL10n.setAttributes(subjectNode, 'message-no-subject');
        subjectNode.classList.add('msg-no-subject');
      }
    }
  };
});
