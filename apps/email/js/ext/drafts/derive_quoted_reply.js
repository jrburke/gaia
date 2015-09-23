define(function (require) {
  'use strict';

  const { effectiveAuthorGivenReplyTo, addressPairFromIdentity,
    replyToFromIdentity } = require('./address_helpers');

  const { generateReplySubject, generateReplyParts } = require('../bodies/mailchew');

  const replyAllRecipients = require('./reply_all_recipients');
  const replyToSenderRecipients = require('./reply_to_sender_recipients');

  const { makeMessageInfo, makeDraftInfo } = require('../db/mail_rep');

  /**
   * Given a populated MessageInfo, derive a new MessageInfo that is a reply to
   * that message.  This is an inherently asynchronous process; you need to yield*
   * to this generator.
   */
  return function* deriveQuotedReply({ sourceMessage, replyMode, identity,
    messageId, umid, guid, date, folderIds }) {
    // -- Figure out the recipients
    var sourceRecipients = {
      to: sourceMessage.to,
      cc: sourceMessage.cc,
      bcc: sourceMessage.bcc
    };
    var sourceEffectiveAuthor = effectiveAuthorGivenReplyTo(sourceMessage.author, sourceMessage.replyTo);
    var replyEffectiveAuthor = effectiveAuthorGivenReplyTo(identity, identity.replyTo && { address: identity.replyTo });

    var recipients = undefined;
    switch (replyMode) {
      case 'sender':
        recipients = replyToSenderRecipients(sourceRecipients, sourceEffectiveAuthor, replyEffectiveAuthor);
        break;
      case 'all':
        recipients = replyAllRecipients(sourceRecipients, sourceEffectiveAuthor, replyEffectiveAuthor);
        break;
      default:
        throw new Error('bad reply mode: ' + replyMode);
    }

    // -- Build the references
    var references = sourceMessage.references.slice();
    // (ActiveSync does not provide a guid; references will be empty too, but
    // pushing an invalid thing would be bad.)
    if (sourceMessage.guid) {
      references.push(sourceMessage.guid);
    }

    // -- Subject
    var subject = generateReplySubject(sourceMessage.subject);

    // -- Build the body
    var bodyReps = yield* generateReplyParts(sourceMessage.bodyReps,
    // Used for the "{author} wrote" bit, which favors display name, so
    // allowing the non-SPF-verified reply-to versus the maybe-SPF-verified
    // true sender doesn't matter because the display name is utterly spoofable.
    sourceEffectiveAuthor, date, identity, sourceMessage.guid);

    var draftInfo = makeDraftInfo({
      draftType: 'reply',
      mode: replyMode,
      refMessageId: sourceMessage.id,
      refMessageDate: sourceMessage.date
    });

    return makeMessageInfo({
      id: messageId,
      umid,
      guid,
      date,
      author: addressPairFromIdentity(identity),
      to: recipients.to,
      cc: recipients.cc,
      bcc: recipients.cc,
      replyTo: replyToFromIdentity(identity),
      flags: [],
      folderIds,
      hasAttachments: false,
      subject,
      // There is no user-authored content at this point, so the snippet is empty
      // by definition.  draft_save will update this.
      snippet: '',
      attachments: [],
      relatedParts: [],
      references,
      bodyReps,
      draftInfo
    });
  };
});
