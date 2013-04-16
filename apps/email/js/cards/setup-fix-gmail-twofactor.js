/*global define*/
define([
  'tmpl!./setup-fix-gmail-twofactor.html',
  'mail-common',
  './setup-fix-password',
  'css!style/setup-cards'
], function (templateNode, common, SetupFixPassword) {

var Cards = common.Cards;

// The app password card is just the bad password card with different text
Cards.defineCardWithDefaultMode(
    'setup-fix-gmail-twofactor',
    { tray: false },
    SetupFixPassword,
    templateNode
);


});
