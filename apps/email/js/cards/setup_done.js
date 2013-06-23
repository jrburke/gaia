/*global define*/
define([
  'tmpl!./setup_done.html',
  'mail_common',
  'mail_app'
], function(templateNode, common, App) {

var Cards = common.Cards;


/**
 * Setup is done; add another account?
 */
function SetupDoneCard(domNode, mode, args) {
  domNode.getElementsByClassName('sup-add-another-account-btn')[0]
    .addEventListener('click', this.onAddAnother.bind(this), false);
  domNode.getElementsByClassName('sup-show-mail-btn')[0]
    .addEventListener('click', this.onShowMail.bind(this), false);
}
SetupDoneCard.prototype = {
  onAddAnother: function() {
    // Nuke all cards
    Cards.removeAllCards();
    // Show the first setup card again.
    Cards.pushCard(
      'setup_account_info', 'default', 'immediate',
      {
        allowBack: true
      });
  },
  onShowMail: function() {
    // Nuke this card
    Cards.removeAllCards();
    // Trigger the startup logic again; this should show the inbox this time.
    App.showMessageViewOrSetup(true);
  },

  die: function() {
  }
};
Cards.defineCardWithDefaultMode(
    'setup_done',
    { tray: false },
    SetupDoneCard,
    templateNode
);

return SetupDoneCard;
});
