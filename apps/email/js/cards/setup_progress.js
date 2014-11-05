/**
 * Show a spinner in for two possible steps in the setup of an account:
 *
 * 1) During the autoconfig step, when figuring out the capabilities of the
 * server, and possibly needing an oauth jump.
 *
 * 2) During the manual config or password flow when finally connecting to the
 * service to confirm password and settings are correct.
 *
 * So the possible flows are:
 *
 * OAuth: setup_account_info -> setup_progress -> setup_account_prefs
 * autoconfig password: setup_account_info -> setup_progress ->
 *                      setup_password -> setup_progress -> setup_account_prefs
 * manual config: setup_account_info -> setup_manual_config ->
 *                setup_progress -> setup_account_prefs
 */
'use strict';
define(function(require) {

var MailAPI = require('api'),
    cards = require('cards'),
    oauthFetch = require('cards/oauth2/fetch');

return [
  require('./base')(require('template!./setup_progress.html')),
  {
    onArgs: function(args) {
      this.args = args;
      this.callingCard = args.callingCard;
      this.creationInProcess = true;

      if (!args.password) {
        this.learnAbout();
      } else {
        // The manual config pathway.
        this.tryCreate();
      }
    },

    extraClasses: ['anim-fade', 'anim-overlay'],

    cancelCreation: function() {
      if (!this.creationInProcess) {
        return;
      }
      // XXX implement cancellation
    },

    pushedCardCanceled: function() {
console.log('##########pushedCardCanceled******');
      //setTimeout(function() {
        this.onBack();
      //}.bind(this), 300);
    },

    onBack: function(e) {
      if (e) {
        e.preventDefault();
      }
      this.cancelCreation();
      cards.removeCardAndSuccessors(this, 'animate', 1);
    },

    /**
     * Trigger the back-end's autoconfig logic based on just knowing the user's
     * email address to figure out what to do next.
     */
    learnAbout: function() {
      MailAPI.learnAboutAccount({
        emailAddress: this.args.emailAddress
      }, function(details) {
        var args = this.args;
        args.configInfo = details.configInfo;
        var result = details.result;

        // - We can autoconfig and it's time to use oauth!
        if (result === 'need-oauth2') {
          oauthFetch(details.configInfo.oauth2Settings, {
            login_hint: args.emailAddress
          })
          .then(function(response) {
            // Cancellation means lose the progress card and go back to entering
            // the user's email address.
            if (response.status === 'cancel') {
              this.onBack();
            // Successful oauth'ing means time to complete the account creation.
            } else if (response.status === 'success') {
              args.configInfo.oauth2Secrets = response.secrets;
              args.configInfo.oauth2Tokens = response.tokens;
              this.tryCreate();
            // Any other error means things did not work.  Things not working
            // implies things will never work and so let's dump the user into
            // the manual config card.
            } else {
              console.error('Unknown oauthFetch status: ' + response.status);
              this._divertToManualConfig();
            }
          }.bind(this), this.onCreationError.bind(this));
        // We can autoconfig but we need the user's password.
        } else if (result === 'need-password') {
          cards.pushCard(
            'setup_account_password', 'animate',
            {
              displayName: args.displayName,
              emailAddress: args.emailAddress,
              callingCard: this
            },
            'right');
        // No configuration data available, the user's only option is manual
        // config.
        } else { // must be no-config-info and even if not, we'd want this.
          this._divertToManualConfig();
        }
      }.bind(this));
    },

    /**
     * learnAbout decided the only option for the user is to manually configure
     * their account.  Sorry, user!
     */
    _divertToManualConfig: function() {
      cards.pushCard('setup_manual_config', 'animate', {
        displayName: this.args.displayName,
        emailAddress: this.args.emailAddress,
        callingCard: this
      },
      'right');
    },

    tryCreate: function() {
      var args = this.args;
      var options = {
        displayName: args.displayName,
        emailAddress: args.emailAddress,
        password: args.password,
        outgoingPassword: args.outgoingPassword
      };

      MailAPI.tryToCreateAccount(
        options,
        args.configInfo || null,
        function(err, errDetails, account) {
          this.creationInProcess = false;
          if (err) {
            this.onCreationError(err, errDetails);
          } else {
            this.onCreationSuccess(account);
          }
        }.bind(this));
    },

    onCreationError: function(err, errDetails) {
      this.callingCard.showError(err, errDetails);
      cards.removeCardAndSuccessors(this, 'animate', 1);
    },

    onCreationSuccess: function(account) {
      cards.pushCard('setup_account_prefs', 'animate',
      {
        account: account
      });
    },

    die: function() {
      this.cancelCreation();
    }
  }
];
});
