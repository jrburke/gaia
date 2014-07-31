# A Makefile just used by email developers for occasional tasks, related to
# updating the repo with new dependencies. Not intended to be used as part of
# the main gaia build process.

# Should be run in the email directory.

.PHONY: bower help

help:
	@echo "No default action, consult Makefile for options"

# To update dependencies that are installed via bower, update the bower.json
# first, then run this command. Inspect the installed files. You may need to
# add more directories/files to this list. Only run this when updating some
# dependencies, and commit the results. We do not want to depend on bower during
# automation/continuous integration/dev debug cycles.
bower:
	bower install
	notobo --alt-main-json=bower.json js/mail_app.js js/lib
	@rm -rf js/lib/gaia-header/dist
	@rm -rf js/lib/gaia-header/.bower.json
	@rm -rf js/lib/gaia-header/bower.json
	@rm -rf js/lib/gaia-icons/.bower.json
	@rm -rf js/lib/gaia-icons/bower.json
	@rm -rf js/lib/gaia-icons/fonts
