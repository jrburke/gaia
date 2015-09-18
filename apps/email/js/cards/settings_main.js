/*global define*/
'use strict';
define(function(require) {

var tngAccountItemNode = require('tmpl!./tng/account_item.html'),
    api = require('api'),
    cards = require('cards');

return [
  require('./base_card')(require('template!./settings_main.html')),
  {
    createdCallback: function() {
      this.accounts = api.accounts;
      this.accounts.on('complete', this, 'onAccountsComplete');

      // Accounts already likely loaded, so do first render.
      this.onAccountsComplete();

      this._secretButtonClickCount = 0;
      this._secretButtonTimer = null;

      this.secretButton.textContent = 'v' + window.emailVersion;
    },

    extraClasses: ['anim-fade', 'anim-overlay'],

    onClose: function() {
      cards.back('animate');
    },

    onAccountsComplete: function() {
      // Just rerender the whole account list.
      var accountsContainer = this.accountsContainer;
      accountsContainer.innerHTML = '';

      if (!this.accounts.items.length) {
        return;
      }

      this.accounts.items.forEach((account, index) => {
        var insertBuddy = (index >= accountsContainer.childElementCount) ?
                          null : accountsContainer.children[index];
        var accountNode = tngAccountItemNode.cloneNode(true);
        var accountLabel =
          accountNode.querySelector('.tng-account-item-label');

        accountLabel.textContent = account.name;
        accountNode.setAttribute('aria-label', account.name);
        // Attaching a listener to account node with the role="option" to
        // enable activation with the screen reader.
        accountNode.addEventListener('click',
          this.onClickEnterAccount.bind(this, account), false);

        accountsContainer.insertBefore(accountNode, insertBuddy);
      });
    },

    onClickAddAccount: function() {
      cards.add('animate', 'setup_account_info', {
        allowBack: true
      });
    },

    onClickEnterAccount: function(account) {
      cards.add('animate', 'settings_account', {
        account: account
      });
    },

    onClickSecretButton: function() {
      if (this._secretButtonTimer === null) {
        this._secretButtonTimer = window.setTimeout(() => {
          this._secretButtonTimer = null;
          this._secretButtonClickCount = 0;
        }, 2000);
      }

      if (++this._secretButtonClickCount >= 5) {
        window.clearTimeout(this._secretButtonTimer);
        this._secretButtonTimer = null;
        this._secretButtonClickCount = 0;
        cards.add('animate', 'settings_debug');
      }
    },

    release: function() {
      this.accounts.removeObjectListener(this);
    }
  }
];
});
