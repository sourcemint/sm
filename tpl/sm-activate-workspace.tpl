#!/bin/bash

############################################################################
# NOTE: This file is generated. Do NOT modify. Your changes will get lost! #
############################################################################

function enquote_all() {
    ARGS=""
    for ARG in "$@"; do
        [ -n "$ARGS" ] && ARGS="$ARGS "
        ARGS="$ARGS'""$(echo " $ARG" | cut -c 2- | sed 's/'"'"'/'"'"'"'"'"'"'"'"'/g')""'"
    done
    echo "$ARGS"
}

if [ "$SM_WORKSPACE_HOME" != "" ]; then
    # TODO: Allow switching to workspace while in workspace. Don't nest workspaces.
    #       i.e. stop existing workspace and then enter new one.
    echo "[sm] ERROR: Cannot switch workspace while in workspace. You must 'exit' workspace first."
    exit 1;
fi

# TODO: Track shell history as part of workspace + ticket session.
# TODO: Hook in auto-complete.

if [ "$#" -lt 1 ]; then
    # TODO: Show activated ticket ID.
    # TODO: Make this work on all terminals and platforms.
    # TODO: Display 'uid' instead of 'name'.
    export SM_HOME=__SM_HOME__
    export PINF_PROGRAM=__PINF_PROGRAM__
    export PINF_PACKAGE=__PINF_PACKAGE__
    export PINF_RUNTIME=__PINF_RUNTIME__
    export PINF_MODE=__PINF_MODE__
    export SM_WORKSPACE_HOME=__SM_WORKSPACE_HOME__
    export PATH=$SM_WORKSPACE_HOME/bin:$SM_WORKSPACE_HOME/.sm/bin:$PATH
    export PS1="\e[00;35msm[\e[00;33m__SM_WORKSPACE_NAME__\e[00;35m]:\e[m "
    cd "$SM_WORKSPACE_HOME"
    echo "[sm] Activating workspace: $SM_WORKSPACE_HOME"
    if [ -f ".sm/.switch" ]; then
        rm ".sm/.switch"
    fi
    BIN_PATH="sm"
    if [ -n "$SM_BIN_PATH" ]; then
        BIN_PATH=$SM_BIN_PATH
    fi
    $BIN_PATH switch --start-workspace
    "$SHELL"
    OLD_PATH=$PWD
    cd "$SM_WORKSPACE_HOME"
    $BIN_PATH switch --stop-workspace
    cd $OLD_PATH
else
    # Run a command through the activated environment without switching to it.
    "$SHELL" -c "$(enquote_all "$@")"
fi
