'use strict';
define(function(require) {

var dataProp = require('./mixins/data-prop'),
    cards = require('cards'),
    containerListen = require('container_listen'),
    evt = require('evt'),
    transitionEnd = require('transition_end');

require('css!style/folder_cards');

return [
  require('./base_card')(),
  require('htemplate/hclick'),
  require('./mixins/model_render')(['accounts', 'folders']),

  {
    createdCallback: function() {
      transitionEnd(this, this.onTransitionEnd.bind(this));
    },

    measureAccountDisplay: function() {
      // Do not bother if the accountHeader is hidden with no height, need it
      // to be visible before calculations will work. So this method should be
      // called both on state changes and once it is known accountHeader is
      // visible enough to calculate correctly.
      if (!this.accountHeaderHeight) {
        this.accountHeaderHeight = this.accountHeader.getBoundingClientRect()
                                   .height;
        if (!this.accountHeaderHeight) {
          return;
        }
      }

      // If more than one account, need to show the account dropdown
      var accountCount = this.renderModel.getAccountCount();

      if (accountCount > 1) {
        // Use the accountHeader as a unit of height and multiple by the number
        // of children, to get total height needed for all accounts. Doing this
        // instead of measuring the height of all accounts, since to get a good
        // measurement needs to not be display none, which could introduce a
        // flash of seeing the element.
        this.currentAccountContainerHeight = this.accountHeaderHeight *
                                             accountCount;
      }
    },

    extraClasses: ['anim-vertical', 'anim-overlay', 'one-account'],

    onShowSettings: function(event) {
      cards.add('animate', 'settings_main', {
        model: this.renderModel
      });
    },

    /**
     * Tapping a different account will jump to the inbox for that
     * account, but only do the jump if a new account selection,
     * and only after hiding the folder_picker.
     */
    onClickAccount: function(event, hclickNode) {
      containerListen.handleEvent(hclickNode, (accountNode) => {
        var oldAccountId = this.renderModel.account.id,
            accountId = accountNode.dataset.accountId;

        if (oldAccountId !== accountId) {
          // Store the ID and wait for the closing animation to finish
          // for the card before switching accounts, so that the
          // animations are smoother and have fewer jumps.
          this._waitingAccountId = accountId;
          this._closeCard();
        }
      }, event);
    },

    toggleAccounts: function() {
      // During initial setup, to get the sizes right for animation later,
      // the translateY was modified. During that time, do not want animation,
      // but now for toggling the display/hiding based on user action, enable
      // it.
      var hadAnimated = this.fldAcctContainer.classList.contains('animated');
      if (!hadAnimated) {
        this.fldAcctContainer.classList.add('animated');
        // Trigger acknowledgement of the transition by causing a reflow
        // for account container element.
        this.fldAcctContainer.clientWidth;
      }

      if (this.accountHeader.classList.contains('closed')) {
        this.showAccounts();
      } else {
        this.hideAccounts();
      }
    },

    /**
     * Use a translateY transition to show accounts. But to do that correctly,
     * need to use the height of the account listing. The scroll inner needs
     * to be updated too, so that it does not cut off some of the folders.
     */
    showAccounts: function() {
      var height = this.currentAccountContainerHeight;
      this.fldAcctScrollInner.style.height = (height +
                   this.foldersContainer.getBoundingClientRect().height) + 'px';
      this.fldAcctContainer.style.transform = 'translateY(0)';

      this.accountHeader.classList.remove('closed');
    },

    /**
     * Use a translateY transition to hide accounts. But to do that correctly,
     * need to use the height of the account listing. The scroll inner needs to
     * be updated too, so that it form-fits over the folder list.
     */
    hideAccounts: function() {
      var foldersHeight = this.foldersContainer.getBoundingClientRect().height;
      if (foldersHeight) {
        this.fldAcctScrollInner.style.height = foldersHeight + 'px';
      }
      this.fldAcctContainer.style.transform = 'translateY(-' +
                           this.currentAccountContainerHeight +
                           'px)';

      this.accountHeader.classList.add('closed');
    },

    afterRender: function() {
      // Wires up the data-prop properties.
      dataProp.templateInsertedCallback.call(this);

      // Since the number of accounts could have changed, redo calculations
      // around the size of the accounts and transform offsets needed.
      this.measureAccountDisplay();

      // If more than one account, need to show the account dropdown
      var accountCount = this.renderModel.getAccountCount();

      if (accountCount > 1) {
        this.hideAccounts();
      }
    },

    render: require('./folder_picker_render'),

    onClickFolder: function(event, hclickNode) {
      containerListen.handleEvent(hclickNode, (folderNode) => {
        var folder = this.renderModel.getFolder(folderNode.dataset.folderId);
        if (!folder.selectable) {
          return;
        }

        this.renderModel.changeFolder(folder);

        this._closeCard();
      }, event);
    },

    onTransitionEnd: function(event) {
      // Only care about the larger card transition, not the transition when
      // showing or hiding the list of accounts.
      if (!event.target.classList.contains('fld-content')) {
        return;
      }

      // If this is an animation for the content closing, then
      // it means the card should be removed now.
      if (!this.classList.contains('opened')) {
        cards.remove(this);

        // After card is removed, then switch the account, to provide
        // smooth animation on closing of drawer.
        if (this._waitingAccountId) {
          var model = this.renderModel;
          model.changeAccountFromId(this._waitingAccountId);
          this._waitingAccountId = null;
        }
      } else {
        // Now that the card is fully opened, measure account display, since
        // size measurement will work now.
        this.measureAccountDisplay();
      }
    },

    // Closes the card. Relies on onTransitionEnd to do the
    // final close, this just sets up the closing transition.
    _closeCard: function() {
      // Stop listening to model changes, do not want account/folder changes
      // triggering rendering.
      this.removeModelRenderListeners();

      evt.emit('folderPickerClosing');
      this.classList.remove('opened');
    },

    /**
     * When the card is visible, start the animations to show the content
     * and fade in the tap shield.
     */
    onCardVisible: function() {
      this.classList.add('opened');
    },

    release: function() {
    }
  }
];
});
