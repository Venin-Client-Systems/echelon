#!/usr/bin/env bash
# Bash completion for Echelon
# Installation:
#   echo "source /path/to/echelon-completion.bash" >> ~/.bashrc
#   source ~/.bashrc

_echelon_completions() {
    local cur prev opts
    COMPREPLY=()
    cur="${COMP_WORDS[COMP_CWORD]}"
    prev="${COMP_WORDS[COMP_CWORD-1]}"

    # Main commands
    local commands="run init status sessions help"

    # Global options
    local global_opts="--help --version --config --directive --headless --dry-run --resume --verbose --yolo --telegram --approval-mode"

    # Status aliases
    if [[ "${COMP_WORDS[1]}" == "s" ]]; then
        COMP_WORDS[1]="status"
    fi

    # Complete subcommands for 'sessions'
    if [[ "${prev}" == "sessions" ]]; then
        COMPREPLY=( $(compgen -W "list prune delete" -- "${cur}") )
        return 0
    fi

    # Complete approval modes
    if [[ "${prev}" == "--approval-mode" ]]; then
        COMPREPLY=( $(compgen -W "destructive all none" -- "${cur}") )
        return 0
    fi

    # Complete config files
    if [[ "${prev}" == "--config" ]] || [[ "${prev}" == "-c" ]]; then
        COMPREPLY=( $(compgen -f -X '!*.json' -- "${cur}") )
        return 0
    fi

    # Complete main commands and options
    if [[ ${cur} == -* ]]; then
        COMPREPLY=( $(compgen -W "${global_opts}" -- "${cur}") )
        return 0
    fi

    COMPREPLY=( $(compgen -W "${commands}" -- "${cur}") )
    return 0
}

complete -F _echelon_completions echelon
