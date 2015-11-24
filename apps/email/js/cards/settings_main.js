/*global define*/
'use strict';
define(function(require) {

var cards = require('cards'),
    htemplate = require('htemplate');

return [
  require('./base_card')(),
  require('htemplate_event'),
  require('./mixins/model_render')('accounts'),
  {
    createdCallback: function() {
      this._secretButtonClickCount = 0;
      this._secretButtonTimer = null;
    },

    extraClasses: ['anim-fade', 'anim-overlay'],

    onClose: function() {
      cards.back('animate');
    },

    render: htemplate(function (h) {
      h`
      <!-- Main settings menu, root of all (mail) settings -->
      <!-- need this section element to keep building blocks happy. Too bad it
        expects a section element -->
      <section class="skin-organic bbshim" role="region">
        <header class="tng-main-header">
          <menu data-event="click:onClose" type="toolbar" class="tng-close-btn">
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

            if (this.state.accounts) {
              this.state.accounts.items.forEach((account, index) => {
                h`
                <li aria-label="${account.name}"
                    class="tng-account-item item-with-children" role="option">
                <a href="#" class="tng-account-item-label list-text">
                  ${account.name}
                </a>
                </li>`;
              });
//todo:
        // Attaching a listener to account node with the role="option" to
        // enable activation with the screen reader.
        // accountNode.addEventListener('click',
        //   this.onClickEnterAccount.bind(this, account), false);
            }

          h`
          </ul>
          <button data-event="click:onClickAddAccount"
                  href="#" data-l10n-id="settings-account-add"
                  class="tng-account-add"></button>
          <a data-event="click:onClickSecretButton"
             class="tng-email-lib-version list-text">${window.emailVersion}</a>
        </section>
      </section>
      `;

      return h();
    }),

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
    }
  }
];
});
