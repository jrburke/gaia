/*global define*/
define([
  'tmpl!./setup-fix-gmail-imap.html',
  'mail-common'
], function (templateNode, common) {

var Cards = common.Cards;

/**
 * Tells the user how to enable IMAP for Gmail
 */
function SetupFixGmailImap(domNode, mode, args) {
  this.domNode = domNode;
  this.account = args.account;
  this.restoreCard = args.restoreCard;

  var accountNode =
    domNode.getElementsByClassName('sup-gmail-imap-account')[0];
  accountNode.textContent = this.account.name;

  var useButton = domNode.getElementsByClassName('sup-dismiss-btn')[0];
  useButton.addEventListener('click', this.onDismiss.bind(this), false);
}
SetupFixGmailImap.prototype = {
  die: function() {
    // no special cleanup required
  },

  onDismiss: function() {
    this.account.clearProblems();
    Cards.removeCardAndSuccessors(this.domNode, 'animate', 1,
                                  this.restoreCard);
  }
};
Cards.defineCardWithDefaultMode(
    'setup-fix-gmail-imap',
    { tray: false },
    SetupFixGmailImap,
    templateNode
);


});