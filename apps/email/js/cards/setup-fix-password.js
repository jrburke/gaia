/*global define*/
define([
  'tmpl!./setup-fix-password.html',
  'mail-common'
], function (templateNode, common) {

var Cards = common.Cards;

/**
 * Asks the user to re-enter their password for the account
 */
function SetupFixPassword(domNode, mode, args) {
  this.domNode = domNode;
  this.account = args.account;
  this.restoreCard = args.restoreCard;

  var accountNode =
    domNode.getElementsByClassName('sup-bad-password-account')[0];
  accountNode.textContent = this.account.name;

  var useButton = domNode.getElementsByClassName('sup-use-password-btn')[0];
  useButton.addEventListener('click', this.onUsePassword.bind(this), false);

  this.passwordNode =
    this.domNode.getElementsByClassName('sup-info-password')[0];
}
SetupFixPassword.prototype = {
  /**
   * Assume we will be successful; update the password, trigger a reauth
   * attempt, then close the card.
   */
  onUsePassword: function() {
    var password = this.passwordNode.value;
    if (password)
      this.account.modifyAccount({ password: password });
    this.account.clearProblems();
    Cards.removeCardAndSuccessors(this.domNode, 'animate', 1,
                                  this.restoreCard);
  },

  die: function() {
    // no special cleanup required
  }
};
Cards.defineCardWithDefaultMode(
    'setup-fix-password',
    { tray: false },
    SetupFixPassword,
    templateNode
);

});
