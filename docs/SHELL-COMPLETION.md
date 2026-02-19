# Shell Completion Setup

Add tab completion for Echelon commands to make it even faster to use!

## Bash Completion

### Installation

```bash
# Copy completion script to your home directory
mkdir -p ~/.echelon
cp completions/echelon-completion.bash ~/.echelon/

# Add to your .bashrc
echo "source ~/.echelon/echelon-completion.bash" >> ~/.bashrc

# Reload your shell
source ~/.bashrc
```

### Test It

```bash
echelon <TAB>           # Shows: run init status sessions help
echelon --<TAB>         # Shows: --help --version --config --yolo etc.
echelon sessions <TAB>  # Shows: list prune delete
```

---

## Zsh Completion

### Installation

```bash
# Create completions directory
mkdir -p ~/.zsh/completions

# Copy completion script
cp completions/echelon-completion.zsh ~/.zsh/completions/_echelon

# Add to your .zshrc (if not already there)
echo "fpath=(~/.zsh/completions \$fpath)" >> ~/.zshrc
echo "autoload -U compinit && compinit" >> ~/.zshrc

# Reload your shell
source ~/.zshrc
```

### Test It

```bash
echelon <TAB>           # Shows commands with descriptions
echelon --<TAB>         # Shows options with help text
echelon sessions <TAB>  # Shows session subcommands
```

---

## Features

### Smart Completions

- **Commands:** `run`, `init`, `status`, `sessions`
- **Options:** `--help`, `--version`, `--config`, `--yolo`, etc.
- **Subcommands:** `sessions list`, `sessions prune`, `sessions delete`
- **Config Files:** Tab completion for `*.json` files
- **Approval Modes:** `destructive`, `all`, `none`

### Examples

```bash
# Type and press TAB:
echelon st<TAB>         → echelon status
echelon --yo<TAB>       → echelon --yolo
echelon -c <TAB>        → shows .json files
echelon --approval-<TAB> → shows mode options
```

---

## Troubleshooting

### Bash: Completion Not Working

```bash
# Check if bash-completion is installed
which bash-completion

# Make sure you've sourced your .bashrc
source ~/.bashrc

# Test manually
source ~/.echelon/echelon-completion.bash
```

### Zsh: Completion Not Working

```bash
# Remove old completion cache
rm ~/.zcompdump*

# Reinitialize completions
autoload -U compinit && compinit

# Test manually
source ~/.zsh/completions/_echelon
```

### Still Not Working?

1. Check file permissions:
   ```bash
   chmod +x completions/echelon-completion.*
   ```

2. Verify installation:
   ```bash
   # Bash
   grep -r "echelon-completion" ~/.bashrc

   # Zsh
   grep -r "completions" ~/.zshrc
   ```

3. Restart your terminal completely

---

## NPM Global Installation

If you installed Echelon globally via npm, completions are already available in:

```
$(npm root -g)/echelon/completions/
```

Follow the installation steps above using that path.

---

## Uninstall

### Bash

```bash
# Remove from .bashrc
sed -i.bak '/echelon-completion/d' ~/.bashrc

# Remove file
rm ~/.echelon/echelon-completion.bash
```

### Zsh

```bash
# Remove from .zshrc
sed -i.bak '/\.zsh\/completions/d' ~/.zshrc

# Remove file
rm ~/.zsh/completions/_echelon
```

---

**Pro Tip:** Shell completion makes you 10x faster at using Echelon! Install it now. 🚀
