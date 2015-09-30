/*global define */
'use strict';
define(function(require) {

var containerListen = require('container_listen'),
    fldFolderItemNode = require('tmpl!./fld/folder_item.html'),
    fldAccountItemNode = require('tmpl!./fld/account_item.html'),
    FOLDER_DEPTH_CLASSES = require('folder_depth_classes'),
    cards = require('cards'),
    evt = require('evt'),
    transitionEnd = require('transition_end');

require('css!style/folder_cards');

return [
  require('./base_card')(require('template!./folder_picker.html')),
  require('./mixins/model_render')(['accounts', 'folders']),

  {
    createdCallback: function() {
      containerListen(this.foldersContainer, 'click',
                      this.onClickFolder.bind(this));

      containerListen(this.accountListContainer, 'click',
                      this.onClickAccount.bind(this));

      transitionEnd(this, this.onTransitionEnd.bind(this));
    },

    /**
     * Called after the element that shows the accounts is visible. Need to wait
     * until the element is visible for the size measurements to be correct.
     */
    initAccountDisplay: function() {
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

      var accountListContainer = this.accountListContainer;
      accountListContainer.innerHTML = '';

      // If more than one account, need to show the account dropdown
      var accountCount = this.renderModel.getAccountCount();

      if (accountCount > 1) {
          // Use the accountHeader as a unit of height and multiple
          // by the number of children, to get total height needed for
          // all accounts. Doing this instead of measuring the height
          // for accountListContainer, since to get a good measurement
          // needs to not be display none, which could introduce a flash
          // of seeing the element.
        this.currentAccountContainerHeight = this.accountHeaderHeight *
                                             accountCount;

        this.hideAccounts();

        // Add DOM for each account.
        if (this.state.accounts) {
          this.state.accounts.items.forEach((account, index) => {
            var childCount = accountListContainer.childElementCount;
            var insertBuddy = (index >= childCount) ?
                              null : accountListContainer.children[index];

            var accountNode = account.element =
              fldAccountItemNode.cloneNode(true);
            accountNode.account = account;
            this.updateAccountDom(account);
            accountListContainer.insertBefore(accountNode, insertBuddy);
          });
        }
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
    onClickAccount: function(accountNode, event) {
      var oldAccountId = this.renderModel.account.id,
          accountId = accountNode.account.id;

      if (oldAccountId !== accountId) {
        // Store the ID and wait for the closing animation to finish
        // for the card before switching accounts, so that the
        // animations are smoother and have fewer jumps.
        this._waitingAccountId = accountId;
        this._closeCard();
      }
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

    render: function() {
      var account = this.renderModel.account;
      if (!account) {
        return;
      }

      this.mostRecentSyncTimestamp = 0;

      // - DOM!
      // update header
      this.querySelector('.fld-acct-header-account-label')
          .textContent = account.name;

      var accountCount = this.state.accounts.items.length;
      this.classList.toggle('one-account', accountCount <= 1);

      // Since the number of accounts could have changed, redo calculations
      // around the size of the accounts and transform offsets needed, and
      // populate the list of accounts.
      this.initAccountDisplay();

      // Update folder contents.
      var foldersContainer = this.foldersContainer;

      foldersContainer.innerHTML = '';

      this.state.folders.items.forEach((folder, index) => {
        var insertBuddy = (index >= foldersContainer.childElementCount) ?
                          null : foldersContainer.children[index];

        var folderNode = folder.element = fldFolderItemNode.cloneNode(true);
        folderNode.folder = folder;
        this.updateFolderDom(folder);
        foldersContainer.insertBefore(folderNode, insertBuddy);
      });
    },

    updateAccountDom: function(account) {
      var accountNode = account.element;

      accountNode.querySelector('.fld-account-name')
        .textContent = account.name;

      // Highlight the account currently in use
      if (this.renderModel.account &&
          this.renderModel.account.id === account.id) {
        accountNode.classList.add('fld-account-selected');
      }
    },

    updateFolderDom: function(folder) {
      var folderNode = folder.element;

      if (!folder.selectable) {
        folderNode.classList.add('fld-folder-unselectable');
      }

      var depthIdx = Math.min(FOLDER_DEPTH_CLASSES.length - 1, folder.depth);
      folderNode.classList.add(FOLDER_DEPTH_CLASSES[depthIdx]);
      if (depthIdx > 0) {
        folderNode.classList.add('fld-folder-depthnonzero');
      }

      folderNode.querySelector('.fld-folder-name')
        .textContent = folder.name;
      folderNode.dataset.type = folder.type;

      if (folder === this.renderModel.folder) {
        folderNode.classList.add('fld-folder-selected');
      } else {
        folderNode.classList.remove('fld-folder-selected');
      }

      // XXX do the unread count stuff once we have that info
    },

    onClickFolder: function(folderNode, event) {
      var folder = folderNode.folder;
      if (!folder.selectable) {
        return;
      }

      this.renderModel.changeFolder(folder);

      this._closeCard();
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
        // Now that the card is fully opened, init account display, since
        // size measurement will work now.
        this.initAccountDisplay();
      }
    },

    // Closes the card. Relies on onTransitionEnd to do the
    // final close, this just sets up the closing transition.
    _closeCard: function() {
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
