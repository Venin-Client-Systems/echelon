#compdef echelon
# Zsh completion for Echelon
# Installation:
#   mkdir -p ~/.zsh/completions
#   cp echelon-completion.zsh ~/.zsh/completions/_echelon
#   echo "fpath=(~/.zsh/completions $fpath)" >> ~/.zshrc
#   echo "autoload -U compinit && compinit" >> ~/.zshrc
#   source ~/.zshrc

_echelon() {
    local -a commands global_opts session_commands approval_modes

    commands=(
        'run:Run the orchestrator (default)'
        'init:Interactive config generator'
        'status:Show current cascade status'
        's:Show current cascade status (alias)'
        'sessions:Manage saved sessions'
        'help:Display help for command'
    )

    global_opts=(
        '--help[Show help message]'
        '--version[Show version number]'
        '--config[Path to config file]:config file:_files -g "*.json"'
        '-c[Path to config file]:config file:_files -g "*.json"'
        '--directive[CEO directive to execute]:directive text:'
        '-d[CEO directive to execute]:directive text:'
        '--headless[Run without TUI]'
        '--dry-run[Show planned cascade without executing]'
        '--resume[Resume the most recent session]'
        '--verbose[Enable debug logging]'
        '-v[Enable debug logging]'
        '--yolo[Full autonomous mode]'
        '--telegram[Start in Telegram bot mode]'
        '--approval-mode[Override approval mode]:mode:(destructive all none)'
    )

    session_commands=(
        'list:List all sessions'
        'prune:Delete completed/failed sessions'
        'delete:Delete a specific session'
    )

    approval_modes=(
        'destructive:Require approval for destructive actions'
        'all:Require approval for all actions'
        'none:Auto-approve all actions'
    )

    _arguments -C \
        '1: :->command' \
        '*:: :->args' && return 0

    case $state in
        command)
            _describe -t commands 'echelon commands' commands
            _describe -t options 'global options' global_opts
            ;;
        args)
            case $words[1] in
                sessions)
                    _describe -t session-commands 'session commands' session_commands
                    ;;
                *)
                    _describe -t options 'options' global_opts
                    ;;
            esac
            ;;
    esac
}

_echelon "$@"
