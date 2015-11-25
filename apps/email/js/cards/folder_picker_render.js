'use strict';
define(function(require) {

var FOLDER_DEPTH_CLASSES = require('folder_depth_classes');

return require('htemplate')(function(h) {
  var account = this.renderModel.account;
  if (!account) {
    return;
  }

  this.mostRecentSyncTimestamp = 0;

  var accountCount = this.state.accounts.items.length;
  this.classList.toggle('one-account', accountCount <= 1);

  h`
  <!-- Our card does not have a header of its own; it reuses the message_list
       header.  We want to steal clicks on its menu button too, hence this node
       and fld-header-back which is a transparent button that overlays the menu
       button. -->
  <div class="fld-header-placeholder" data-statuscolor="default">
    <!-- Unlike a generic back button that navigates to a different screen,
         folder picker header button triggers the folders and settings overlay
         closure. Thus the screen reader user requires more context as to what
         activating the button would do. -->
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
    <!-- This is the actual drawer thing that slides up/down using translateY.
         -->
    <div class="fld-content">
      <!-- Scrollable container holds everything but the non-scrolling settings
           button. -->
      <div class="fld-acct-scrollouter">
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
      </div>
      <!-- settings button; always present; does not scroll -->
      <a data-hclick="onShowSettings"
         class="fld-nav-toolbar bottom-toolbar">
        <span class="fld-settings-link"
              data-l10n-id="drawer-settings-link"></span>
      </a>
    </div>
  </div>
  `;
});

});
