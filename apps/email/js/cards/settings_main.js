/*global define*/
define(function(require) {
'use strict';

var cards = require('cards');

return [
  require('./mixins/data-dclick'),

  require('./base_render')(['accounts'], function(html) {
    html`
    <!-- Main settings menu, root of all (mail) settings -->
    <!-- need this section element to keep building blocks happy. Too bad it
      expects a section element -->
    <section class="skin-organic bbshim" role="region">
      <header class="tng-main-header">
        <menu data-dclick="onBack" type="toolbar" class="tng-close-btn">
          <button data-l10n-id="settings-done"></button>
        </menu>
        <h1 class="tng-main-header-label"
            data-l10n-id="settings-main-header"></h1>
      </header>
      <section class="scrollregion-below-header skin-organic" role="region">
        <header class="collapsed"></header>
        <header class="tng-main-accounts-label">
          <h2 data-l10n-id="settings-account-section"></h2>
        </header>
        <ul class="tng-accounts-container"
            data-l10n-id="settings-account-listbox" role="listbox">
        `;

          if (this.state.accounts && this.state.accounts.items) {
            this.state.accounts.items.forEach((account) => {
              html`
              <li aria-label="${account.name}"
                  class="tng-account-item item-with-children" role="option">
              <a href="#" class="tng-account-item-label list-text"
                 data-account-id="${account.id}"
                 data-dclick="onClickEnterAccount">
                ${account.name}
              </a>
              </li>`;
            });
          }

        html`
        </ul>
        <button data-dclick="onClickAddAccount"
                href="#" data-l10n-id="settings-account-add"
                class="tng-account-add"></button>
        <a data-dclick="onClickSecretButton"
           class="tng-email-lib-version list-text">${window.emailVersion}</a>
      </section>
    </section>
    `;
  }),

  {
    createdCallback: function() {
      this._secretButtonClickCount = 0;
      this._secretButtonTimer = null;
    },

    extraClasses: ['anim-fade', 'anim-overlay'],

    onClickAddAccount: function() {
      cards.add('animate', 'setup_account_info', {
        allowBack: true
      });
    },

    onClickEnterAccount: function(evt) {
      var accountId = evt.target.dataset.accountId;
      if (!accountId) {
        return;
      }

      var account = this.model.getAccount(accountId);
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
    }
  }
];
});
