'use strict';
define(function(require) {

var cards = require('cards'),
    FormNavigation = require('form_navigation');

// Function to avoid jshint error about "Do not use 'new' for side effects"
function bindFormNavigation(instance) {
  return new FormNavigation({
    formElem: instance.formNode,
    onLast: instance.onNext.bind(instance)
  });
}

return [
  require('./base_card')(require('template!./setup_account_password.html')),
  require('./setup_account_error_mixin'),
  {
    onArgs: function(args) {
      this.emailAddress = args.emailAddress;

      this.emailNode.textContent = this.emailAddress;
      this.needsFocus = true;

      bindFormNavigation(this);
    },

    onCardVisible: function() {
      // Only focus in the form fields if this is the first time the card is
      // being shown.
      if (this.needsFocus) {
        this.passwordNode.focus();
        this.needsFocus = false;
      }
    },

    onNext: function(event) {
      event.preventDefault(); // Prevent FormNavigation from taking over.

      this.args.password = this.passwordNode.value;

      // The progress card is the dude that actually tries to create the
      // account. Send a new object for sanitation, avoid state modifications
      // downstream.
      cards.add('animate', 'setup_progress', Object.assign({
        // (passed for cancellation purposes)
        setupController: this.args.setupController
      }, this.args));
      // asuth unsure not: it seems like setup_progress usage from oauth no
      // longer wants/expects setup_progress to trigger this.  Instead we want
      // to trigger and the setup controller takes care of everything.
      this.args.setupController.tryCreate(this.args);
    },

    onInfoInput: function(event) {
      this.nextButton.disabled = !this.formNode.checkValidity();
    },

    release: function() {
    }
  }
];
});
