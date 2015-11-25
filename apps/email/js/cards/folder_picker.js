'use strict';
define(function(require) {

var cards = require('cards'),
    dataEvent = require('./mixins/data-event'),
    evt = require('evt'),
    htemplate = require('htemplate'),
    transitionEnd = require('transition_end');

require('css!style/folder_cards');

// Custom elements used in the template.
require('element!./fld/accounts-folders');

return [
  require('./base_card')(),
  require('htemplate/hclick'),
  require('./mixins/model_render')(),

  {
    createdCallback: function() {
      transitionEnd(this, this.onTransitionEnd.bind(this));
    },

    extraClasses: ['anim-vertical', 'anim-overlay', 'one-account'],

    onShowSettings: function(event) {
      cards.add('animate', 'settings_main', {
        model: this.renderModel
      });
    },

    /**
     * Triggered by the accounts_folders component.
     */
    accountSelected: function(event) {
      var accountId = event.detail.accountId;

      // Store the ID and wait for the closing animation to finish
      // for the card before switching accounts, so that the
      // animations are smoother and have fewer jumps.
      this._waitingAccountId = accountId;
      this._closeCard();
    },


    folderSelected: function(event) {
      var folder = event.detail.folder;
      this.renderModel.changeFolder(folder);
      this._closeCard();
    },

    render: htemplate(function(h) {
      h`
      <!-- Our card does not have a header of its own; it reuses the
           message_list header.  We want to steal clicks on its menu button too,
           hence this node and fld-header-back which is a transparent button
           that overlays the menu button. -->
      <div class="fld-header-placeholder" data-statuscolor="default">
        <!-- Unlike a generic back button that navigates to a different screen,
             folder picker header button triggers the folders and settings
             overlay closure. Thus the screen reader user requires more context
             as to what activating the button would do. -->
        <button aria-expanded="true" aria-controls="cards-folder-picker"
                data-l10n-id="message-list-menu"
                data-hclick="_closeCard"
                class="fld-header-back"></button>
      </div>
      <!-- Backing semi-opaque layer for everything below the header so that
           anything that the folder drawer does not cover looks inactive-ish.
           Clicking on this makes the drawer go away. -->
      <div data-hclick="_closeCard" class="fld-shield"></div>
      <!-- This exists to clip fld-content so that when it animates in/out using
           translateY it does not paint over-top of the header. -->
      <div class="fld-content-container">
        <!-- This is the actual drawer thing that slides up/down using
             translateY. -->
        <div class="fld-content">
          <!-- Scrollable container holds everything but the non-scrolling
               settings button. -->
          <cards-fld-accounts-folders class="fld-acct-scrollouter"
                 data-event="folderSelected,accountSelected">
          </cards-fld-accounts-folders>
          <!-- settings button; always present; does not scroll -->
          <a data-hclick="onShowSettings"
             class="fld-nav-toolbar bottom-toolbar">
            <span class="fld-settings-link"
                  data-l10n-id="drawer-settings-link"></span>
          </a>
        </div>
      </div>
      `;
    }),

    renderEnd: function() {
      dataEvent.templateInsertedCallback.call(this);
      //todo: hack:
      this.querySelector('cards-fld-accounts-folders').onArgs({
        model: this.renderModel
      });
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
        this.querySelector('cards-fld-accounts-folders')
            .measureAccountDisplay();
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
