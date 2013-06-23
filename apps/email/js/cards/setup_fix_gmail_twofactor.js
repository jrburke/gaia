/*global define*/
define([
  'tmpl!./setup_fix_gmail_twofactor.html',
  'mail_common',
  './setup_fix_password'
], function(templateNode, common, SetupFixPassword) {

var Cards = common.Cards;

// The app password card is just the bad password card with different text
Cards.defineCardWithDefaultMode(
    'setup_fix_gmail_twofactor',
    { tray: false },
    SetupFixPassword,
    templateNode
);

return SetupFixPassword;
});
