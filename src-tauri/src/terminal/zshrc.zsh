# The user's .zshrc (see .zshenv here), then git completion if their config didn't set up
# completion, then ZDOTDIR back to the user's so zsh reads their .zlogin and child shells start
# normally.
GITMENU_ZDOTDIR=$ZDOTDIR

# macOS /etc/zshrc put the history file in ZDOTDIR, which was this directory
if [[ $HISTFILE == $GITMENU_ZDOTDIR/.zsh_history ]]; then
	HISTFILE=$USER_ZDOTDIR/.zsh_history
fi

if [[ $options[norcs] = off && -f $USER_ZDOTDIR/.zshrc ]]; then
	ZDOTDIR=$USER_ZDOTDIR
	. "$USER_ZDOTDIR/.zshrc"
	USER_ZDOTDIR=$ZDOTDIR
fi

# zsh ships git's completion; it only needs the completion system, which a plain config lacks
if (( ! $+functions[compdef] )); then
	autoload -Uz compinit && compinit -i -d "$GITMENU_ZDOTDIR/.zcompdump"
fi

if [[ $USER_ZDOTDIR == $HOME ]]; then
	unset ZDOTDIR
else
	ZDOTDIR=$USER_ZDOTDIR
fi
unset USER_ZDOTDIR GITMENU_ZDOTDIR
