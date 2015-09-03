/**
 * Handles control flow for account setup.
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

var cards = require('cards'),
    MailAPI = require('api'),
    mix = require('mix'),
    oauthFetch = require('cards/oauth2/fetch');

function SetupController() {
  this.setupAccountInfoCard = null;
  this.creationInProcess = false;
  this.createCanceled = false;

  this._removeProgressCard = this._removeProgressCard.bind(this);
}

SetupController.prototype = {
  _init: function(setupCard) {
    this.setupAccountInfoCard = setupCard;
    this.progressCard = null;
    this.creationInProcess = true;
    this.createCanceled = false;
  },

  _removeProgressCard: function() {
    if (this.progressCard) {
      cards.remove(this.progressCard);
      this.progressCard = null;
    }
  },

  start: function(setupCard, args) {
    this._init(setupCard);

    cards.add('animate', 'setup_progress', {
      setupController: this
    }).then((progressNode) => {
      this.progressCard = progressNode;
      this.learnAbout(args);
    });
  },

  startManual: function(setupCard, args) {
    this._init(setupCard);

    cards.add('animate', 'setup_manual_config', mix({
      setupController: this
    }, args));
  },

  cancel: function(err, errDetails) {
    this.createCanceled = true;
    this.creationInProcess = false;

    if (err) {
      this.setupAccountInfoCard.showError(err, errDetails);
    }

    // Remove cards between the initial card and the one active one.
    cards.removeBetweenActive(this.setupAccountInfoCard);

    // Long term, use API to cancel account creation here.
  },

  /**
   * Trigger the back-end's autoconfig logic based on just knowing the user's
   * email address to figure out what to do next.
   */
  learnAbout: function(args) {
    MailAPI.learnAboutAccount({
      emailAddress: args.emailAddress
    }, (details) => {
      args.configInfo = details.configInfo;
      var result = details.result;

      // - We can autoconfig and it's time to use oauth!
      if (result === 'need-oauth2') {
        oauthFetch(details.configInfo.oauth2Settings, {
          login_hint: args.emailAddress
        }, {
          onArgCreated: (oauthCard) => {
            // Override the close from successful location change to show
            // progress spinner.
            oauthCard.closeFromLocationChange = () => {
              cards.add('animate', 'setup_progress', {
                setupController: this
              });
            };
            this._removeProgressCard();
          }
        })
        .then((response) => {
          // Cancellation means lose the progress card and go back to entering
          // the user's email address.
          if (response.status === 'cancel') {
            this.cancel();
          // Successful oauth'ing means time to complete the account creation.
          } else if (response.status === 'success') {
            args.configInfo.oauth2Secrets = response.secrets;
            args.configInfo.oauth2Tokens = response.tokens;
            this.tryCreate(args);
          // Any other error means things did not work.  Things not working
          // implies things will never work and so let's dump the user into
          // the manual config card.
          } else {
            console.error('Unknown oauthFetch status: ' + response.status);
            this._divertToManualConfig(args);
          }
        }, this.cancel.bind(this));
      // We can autoconfig but we need the user's password.
      } else if (result === 'need-password') {
        cards.add('animate', 'setup_account_password', {
          displayName: args.displayName,
          emailAddress: args.emailAddress,
          setupController: this
        }).then(this._removeProgressCard);
      // No configuration data available, the user's only option is manual
      // config.
      } else { // must be no-config-info and even if not, we'd want this.
        this._divertToManualConfig(args);
      }
    });
  },

  /**
   * learnAbout decided the only option for the user is to manually configure
   * their account.  Sorry, user!
   */
  _divertToManualConfig: function(args) {
    cards.add('animate', 'setup_manual_config', {
      displayName: args.displayName,
      emailAddress: args.emailAddress,
      setupController: this
    }).then(this._removeProgressCard);
  },

  tryCreate: function(args) {
    var options = {
      displayName: args.displayName,
      emailAddress: args.emailAddress,
      password: args.password,
      outgoingPassword: args.outgoingPassword
    };

    MailAPI.tryToCreateAccount(options, args.configInfo || null,
    (err, errDetails, account) => {
      this.creationInProcess = false;
      if (err) {
        this.cancel(err, errDetails);
      } else {
        if (this.createCanceled) {
          account.deleteAccount();
          this.cancel();
        } else {
          this.onCreationSuccess(account);
        }
      }
    });
  },

  manualCreate: function(args) {
    cards.add('animate', 'setup_progress', args)
    .then((progressNode) => this.tryCreate(args));
  },

  onCreationSuccess: function(account) {
    cards.add('animate', 'setup_account_prefs', {
      account: account,
      setupController: this
    });
  }
};

return SetupController;

});
