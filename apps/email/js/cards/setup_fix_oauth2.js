'use strict';
define(function(require) {

var oauthFetch = require('./oauth2/fetch'),
    cards = require('cards');

return [
  require('./base_card')(require('template!./setup_fix_oauth2.html')),
  {
    extraClasses: ['anim-fade', 'anim-overlay'],

    onArgs: function(args) {
      this.account = args.account;

      // The account name is not translatable; set it verbatim.
      this.oauth2Name.textContent = this.account.name;
    },

    release: function() {
      // no special cleanup required
    },

    onReauth: function(event) {
      event.stopPropagation();
      event.preventDefault();

      var oauth2 = this.account._wireRep.credentials.oauth2;
      oauthFetch(oauth2, {
        login_hint: this.account.username
      }, {
        intermediateCard: this
      })
      .then((response) => {
        // Cancellation means hide this UI.
        if (response.status === 'cancel') {
          console.log('setup_fix_oauth2 oauth canceled');
        // Success means victory.
        } else if (response.status === 'success') {
          this.account.modifyAccount({ oauthTokens: response.tokens });
          this.account.clearProblems();

        // Anything else means a failure and it's also time to close.
        } else {
          console.error('Unknown oauthFetch status: ' + response.status);
        }
      });
    },

    close: function(event) {
      if (event) {
        event.stopPropagation();
        event.preventDefault();
      }

      cards.back('animate');
    }
  }
];
});
