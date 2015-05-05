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
      this.accounts.on('complete', this, 'onAccountChange');
      this.accounts.on('change', this, 'onAccountChange');

      // Accounts already likely loaded, so do first render.
      this.onAccountChange();

      this._secretButtonClickCount = 0;
      this._secretButtonTimer = null;
    },

    extraClasses: ['anim-fade', 'anim-overlay'],

    onClose: function() {
      cards.removeCardAndSuccessors(this, 'animate', 1, 1);
    },

    onAccountChange: function() {
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
      cards.pushCard(
        'setup_account_info', 'animate',
        {
          allowBack: true
        },
        'right');
    },

    onClickEnterAccount: function(account) {
      cards.pushCard(
        'settings_account', 'animate',
        {
          account: account
        },
        'right');
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
        cards.pushCard('settings_debug', 'animate', {}, 'right');
      }
    },

    release: function() {
      this.accounts.removeObjectListener(this);
    }
  }
];
});
