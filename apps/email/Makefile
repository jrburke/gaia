ifeq ($(SYS),Darwin)
# For mac we have the xulrunner-sdk so check for this directory
# We're on a mac
XULRUNNERSDK=../../xulrunner-sdk/bin/run-mozilla.sh
XPCSHELLSDK=../../xulrunner-sdk/bin/xpcshell
else ifeq ($(findstring MINGW32,$(SYS)), MINGW32)
XULRUNNERSDK=
XPCSHELLSDK=../../xulrunner-sdk/bin/xpcshell
else
# Otherwise, assume linux
XULRUNNERSDK=../../xulrunner-sdk/bin/run-mozilla.sh
XPCSHELLSDK=../../xulrunner-sdk/bin/xpcshell
endif

concatenated_scripts:
	$(XULRUNNERSDK) $(XPCSHELLSDK) ../../build/r.js -o build/email.build.js
