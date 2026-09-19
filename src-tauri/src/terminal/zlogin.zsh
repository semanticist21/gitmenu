# Read only when .zshrc wasn't (a non-interactive login shell): the user's .zlogin (see .zshenv
# here), then ZDOTDIR back to the user's.
ZDOTDIR=$USER_ZDOTDIR
if [[ $options[norcs] = off && -f $ZDOTDIR/.zlogin ]]; then
	. "$ZDOTDIR/.zlogin"
fi
if [[ $ZDOTDIR == $HOME ]]; then
	unset ZDOTDIR
fi
unset USER_ZDOTDIR GITMENU_ZDOTDIR
