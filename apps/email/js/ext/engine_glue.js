define(function () {
  'use strict';

  /**
   * We map arbitrary engine-related identifiers to the module identifiers of the
   * modules that provide them.  It's on you to do the require() call yourself.
   *
   * Currently we use two type of identifiers:
   * - Account Type Strings (old, but not going away):
   *   - imap+smtp
   *   - pop3+smtp
   *   - activesync
   * - Engine Id Strings (new):
   *   - gmailImap
   *   - vanillaImap
   *   - activesync
   *   - pop3
   */
  return {
    /**
     * Maps account types to their configurator module id.  It's assumed that the
     * module requiring them is under ./tasks.
     */
    configuratorModules: new Map([['activesync', '../activesync/configurator'], ['imap+smtp', '../composite/configurator'], ['pop3+smtp', '../composite/configurator']]),

    /**
     * Maps account types to their validator module id.  It's assumed that the
     * module requiring them is under ./tasks.
     */
    validatorModules: new Map([['activesync', '../activesync/validator'], ['imap+smtp', '../composite/validator'], ['pop3+smtp', '../composite/validator']]),

    /**
     * Maps account types to their account module id.  It's assumed that the
     * module requiring them is ./universe/account_manager.
     */
    accountModules: new Map([['activesync', '../activesync/account'], ['imap+smtp', '../composite/account'], ['pop3+smtp', '../composite/account']]),

    /**
     * Maps engine id's to their task module id.  It's assumed that the module
     * requiring them is ./universe/account_manager, or something equally nested.
     */
    engineTaskMappings: new Map([['gmailImap', '../imap/gmail_tasks'], ['vanillaImap', '../imap/vanilla_tasks'], ['activesync', '../activesync/activesync_tasks'], ['pop3', '../pop3/pop3_tasks']]),

    /**
     * Maps engine id's to metadata about engines to tell the front-end by
     * annotating stuff onto the account wire rep.  This was brought into
     * existence for syncGranularity purposes, but the idea is that anything that
     * varies on an account/engine basis should go in here.  This allows new
     * useful info to be added without requiring the front-end to have its own
     * hardcoded assumptions or us to stick it in the account defs and migrate the
     * accounts, etc.
     *
     * The keys are engine id's, the values are Objects that are mixed into the
     * returned account info sent via the AccountsTOC.  In general I suggest we
     * try and cluster things into things like `engineFacts`.
     */
    engineFrontEndAccountMeta: new Map([['gmailImap', {
      engineFacts: {
        syncGranularity: 'account'
      }
    }], ['vanillaImap', {
      engineFacts: {
        syncGranularity: 'folder'
      }
    }], ['activesync', {
      engineFacts: {
        syncGranularity: 'folder'
      }
    }], ['pop3', {
      engineFacts: {
        // This could arguably be 'account' too, but that would hinge on us
        // having some type of local folder stuff going on.  We can of course
        // revisit this as needed.
        syncGranularity: 'folder'
      }
    }]]),

    /**
     * Maps engine id's to metadata about engines to tell the front-end by
     * annotating stuff onto account-owned folder reps.  Same deal as
     * `engineFrontEndAccountMeta` but for folders, basically.
     *
     * Note that we currently do not wrap things under anything like `engineFacts`
     * because we want to let folders generally be engine-agnostic.  (While
     * the engine is a huge aspect of what an account is, and the account wire
     * rep is already a big soupy mess of stuff.)
     */
    engineFrontEndFolderMeta: new Map([['gmailImap', {
      syncGranularity: 'account'
    }], ['vanillaImap', {
      syncGranularity: 'folder'
    }], ['activesync', {
      syncGranularity: 'folder'
    }], ['pop3', {
      syncGranularity: 'folder'
    }]])
  };
});
