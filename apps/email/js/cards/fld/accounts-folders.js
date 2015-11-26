'use strict';
define(function(require) {

var dataProp = require('../mixins/data-prop'),
    containerListen = require('container_listen'),
    FOLDER_DEPTH_CLASSES = require('folder_depth_classes');

return [
  require('../base')(),
  require('htemplate/hclick'),
  require('../mixins/model_render')(['accounts', 'folders']),

  {
    render: require('htemplate')(function(h) {
      var account = this.renderModel.account;
      if (!account) {
        return;
      }

      this.mostRecentSyncTimestamp = 0;

      var accountCount = this.state.accounts.items.length;
      this.classList.toggle('one-account', accountCount <= 1);

      h`
      <!-- Combo-box style widget that shows the current account name when
           collapsed and the fld-acct-header-account-header label when
           expanded.  The actual items live in fld-accountlist-container
           for animation reasons; see below. -->
      <a data-prop="accountHeader"
         data-hclick="toggleAccounts"
         class="fld-acct-header closed" role="region">
        <!--
          The &nbsp; is on purpose, so that initial height measurement of the
          element be correct even before this element has real content.
        -->
        <span class="fld-acct-header-account-label">${account.name}</span>
        <span class="fld-acct-header-account-header"
              data-l10n-id="drawer-accounts-header"></span>
        <span class="fld-account-switch-arrow"></span>
      </a>
      <!-- Exists to clip fld-acct-container which uses translateY to hide the
           list of accounts in negative-space until the account list is
           opened.  This has an explicit height style set based on whether the
           list of accounts is displayed or not because fld-acct-scrollinner
           will always have the same height for layout purposes because the
           translateY hiding does not affect layout. -->
      <div data-prop="fldAcctScrollInner" class="fld-acct-scrollinner">
        <!-- The list of all accounts and the folders for the current account.
             As noted above, translateY is used to hide the list of accounts
             when we do not want to be displaying it. -->
        <div data-prop="fldAcctContainer" class="fld-acct-container">
          <!-- The list of accounts -->
          <div data-prop="accountContainer"
               data-hclick="onClickAccount"
               class="fld-accountlist-container collapsed">
          `;

          // Add DOM for each account.
          if (this.state.accounts) {
            this.state.accounts.items.forEach((account, index) => {
              // Highlight the account currently in use
              var selectedClass = this.renderModel.account &&
                                  this.renderModel.account.id === account.id ?
                                  'fld-account-selected' : '';

              h`
              <a class="fld-account-item ${selectedClass}"
                 data-account-id="${account.id}">
                <span class="selected-indicator"></span>
                <span class="fld-account-name">${account.name}</span>
              </a>
              `;
            });
          }

          h`
          </div>
          <!-- The list of folders for the current account. -->
          <div data-prop="foldersContainer"
               data-hclick="onClickFolder"
               class="fld-folders-container">
          `;

            if (this.state.folders) {
              this.state.folders.items.forEach((folder, index) => {
                var extraClasses = [];

                if (!folder.selectable) {
                  extraClasses.push('fld-folder-unselectable');
                }

                var depthIdx = Math.min(FOLDER_DEPTH_CLASSES.length - 1,
                                        folder.depth);
                extraClasses.push(FOLDER_DEPTH_CLASSES[depthIdx]);
                if (depthIdx > 0) {
                  extraClasses.push('fld-folder-depthnonzero');
                }

                if (folder === this.renderModel.folder) {
                  extraClasses.push('fld-folder-selected');
                }

                h`
                <a class="fld-folder-item ${extraClasses.join(' ')}"
                   data-type="${folder.type}"
                   data-folder-id="${folder.id}">
                  <span class="selected-indicator"></span>
                  <span dir="auto"
                        class="fld-folder-name">${folder.name}</span>
                  <span class="fld-folder-unread"></span>
                </a>
                `;
              });
            }

          h`
          </div>
        </div>
      </div>
      `;
    }),

    // Triggered by model_render when rendering is done.
    renderEnd: function() {
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

    // Called by owner, when it is known to be visible.
    measureAccountDisplay: function() {
      // Do not bother if the accountHeader is hidden with no height, need it
      // to be visible before calculations will work. So this method should be
      // called both on state changes and once it is known accountHeader is
      // visible enough to calculate correctly.
      if (this.accountHeader && !this.accountHeaderHeight) {
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

        this.accountContainer.classList.remove('collapsed');
        this.hideAccounts();
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
      if (!this.currentAccountContainerHeight) {
        return;
      }

      var foldersHeight = this.foldersContainer.getBoundingClientRect().height;
      if (foldersHeight) {
        this.fldAcctScrollInner.style.height = foldersHeight + 'px';
      }
      this.fldAcctContainer.style.transform = 'translateY(-' +
                           this.currentAccountContainerHeight +
                           'px)';

      this.accountHeader.classList.add('closed');
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
          this.emitDomEvent('accountSelected', { accountId });
        }
      }, event);
    },

    onClickFolder: function(event, hclickNode) {
      containerListen.handleEvent(hclickNode, (folderNode) => {
        var folder = this.renderModel.getFolder(folderNode.dataset.folderId);
        if (!folder.selectable) {
          return;
        }

        this.emitDomEvent('folderSelected', { folder });
      }, event);
    }
  }
];
});
