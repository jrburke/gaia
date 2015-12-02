define(function (require) {
  'use strict';

  /**
   * Sender identities define one of many possible sets of sender info and are
   * associated with a single `MailAccount`.
   *
   * Things that can vary:
   * - user's display name
   * - e-mail address,
   * - reply-to address
   * - signature
   */
  function MailSenderIdentity(api, wireRep) {
    // We store the API so that we can create identities for the composer without
    // needing to create an account too.
    this._api = api;
    this.id = wireRep.id;

    this.name = wireRep.name;
    this.address = wireRep.address;
    this.replyTo = wireRep.replyTo;
    this.signature = wireRep.signature;
    this.signatureEnabled = wireRep.signatureEnabled;
  }
  MailSenderIdentity.prototype = {
    toString: function () {
      return '[MailSenderIdentity: ' + this.type + ' ' + this.id + ']';
    },
    toJSON: function () {
      return { type: 'MailSenderIdentity' };
    },

    __update: function (wireRep) {
      this.id = wireRep.id;
      this.name = wireRep.name;
      this.address = wireRep.address;
      this.replyTo = wireRep.replyTo;
      this.signature = wireRep.signature;
      this.signatureEnabled = wireRep.signatureEnabled;
    },
    /**
     * Modifies the identity. Applies all of the changes in mods
     * and leaves all other values the same.
     *
     * @param  {Object}   mods     The changes to be applied
     * @param  {Function} callback
     */
    modifyIdentity: function (mods, callback) {
      // These update signature data immediately, so that the UI
      // reflects the changes properly before the backend properly
      // updates the data
      if (typeof mods.signature !== 'undefined') {
        this.signature = mods.signature;
      }
      if (typeof mods.signatureEnabled !== 'undefined') {
        this.signatureEnabled = mods.signatureEnabled;
      }
      this._api._modifyIdentity(this, mods, callback);
    },

    release: function () {
      // nothing to clean up currently
    }
  };

  return MailSenderIdentity;
});
