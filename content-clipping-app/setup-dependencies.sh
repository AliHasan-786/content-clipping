#!/bin/bash

set -e

echo "🚀 Video Processing Dependencies Setup Script"
echo "============================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "ℹ️  $1"
}

# Detect OS
OS="unknown"
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macOS"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    if [ -f /etc/ubuntu-release ] || [ -f /etc/debian_version ]; then
        OS="ubuntu"
    elif [ -f /etc/redhat-release ] || [ -f /etc/centos-release ]; then
        OS="centos"
    else
        OS="linux"
    fi
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
    OS="windows"
fi

print_info "Detected OS: $OS"
echo ""

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check and install Homebrew on macOS
setup_homebrew() {
    if [[ "$OS" == "macOS" ]]; then
        if ! command_exists brew; then
            print_warning "Homebrew not found. Installing Homebrew..."
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
            
            # Add Homebrew to PATH for Apple Silicon Macs
            if [[ $(uname -m) == "arm64" ]]; then
                echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zshrc
                eval "$(/opt/homebrew/bin/brew shellenv)"
            fi
            
            print_status "Homebrew installed successfully"
        else
            print_status "Homebrew already installed"
        fi
    fi
}

# Install FFmpeg
setup_ffmpeg() {
    print_info "Setting up FFmpeg..."
    
    if command_exists ffmpeg; then
        print_status "FFmpeg already installed: $(ffmpeg -version 2>&1 | head -1)"
        return
    fi
    
    case $OS in
        "macOS")
            print_info "Installing FFmpeg via Homebrew..."
            brew install ffmpeg
            ;;
        "ubuntu")
            print_info "Installing FFmpeg via apt..."
            sudo apt update
            sudo apt install -y ffmpeg
            ;;
        "centos")
            print_info "Installing FFmpeg via yum/dnf..."
            # Enable EPEL repository first
            if command_exists dnf; then
                sudo dnf install -y epel-release
                sudo dnf install -y ffmpeg ffmpeg-devel
            else
                sudo yum install -y epel-release
                sudo yum install -y ffmpeg ffmpeg-devel
            fi
            ;;
        "windows")
            print_error "Windows detected. Please install FFmpeg manually:"
            echo "1. Download FFmpeg from: https://ffmpeg.org/download.html#build-windows"
            echo "2. Extract to C:\\ffmpeg"
            echo "3. Add C:\\ffmpeg\\bin to your PATH environment variable"
            echo "4. Restart your terminal and run this script again"
            exit 1
            ;;
        *)
            print_error "Unsupported OS for automatic FFmpeg installation."
            echo "Please install FFmpeg manually for your system:"
            echo "- Visit: https://ffmpeg.org/download.html"
            echo "- Follow the instructions for your operating system"
            exit 1
            ;;
    esac
    
    if command_exists ffmpeg; then
        print_status "FFmpeg installed successfully: $(ffmpeg -version 2>&1 | head -1)"
    else
        print_error "FFmpeg installation failed"
        exit 1
    fi
}

# Install Redis
setup_redis() {
    print_info "Setting up Redis..."
    
    if command_exists redis-server; then
        print_status "Redis already installed"
        
        # Check if Redis is running
        if pgrep -x "redis-server" > /dev/null; then
            print_status "Redis is already running"
        else
            print_info "Starting Redis..."
            case $OS in
                "macOS")
                    if command_exists brew; then
                        brew services start redis
                    else
                        redis-server --daemonize yes
                    fi
                    ;;
                "ubuntu"|"centos")
                    sudo systemctl start redis
                    sudo systemctl enable redis
                    ;;
                *)
                    redis-server --daemonize yes
                    ;;
            esac
            print_status "Redis started"
        fi
        return
    fi
    
    case $OS in
        "macOS")
            print_info "Installing Redis via Homebrew..."
            brew install redis
            brew services start redis
            ;;
        "ubuntu")
            print_info "Installing Redis via apt..."
            sudo apt update
            sudo apt install -y redis-server
            sudo systemctl start redis
            sudo systemctl enable redis
            ;;
        "centos")
            print_info "Installing Redis via yum/dnf..."
            if command_exists dnf; then
                sudo dnf install -y redis
            else
                sudo yum install -y redis
            fi
            sudo systemctl start redis
            sudo systemctl enable redis
            ;;
        "windows")
            print_error "Windows detected. Please install Redis manually:"
            echo "1. Download Redis from: https://redis.io/download"
            echo "2. Or use Windows Subsystem for Linux (WSL)"
            echo "3. Or use Docker: docker run -d -p 6379:6379 redis:alpine"
            exit 1
            ;;
        *)
            print_error "Unsupported OS for automatic Redis installation."
            echo "Please install Redis manually for your system:"
            echo "- Visit: https://redis.io/download"
            exit 1
            ;;
    esac
    
    # Test Redis connection
    if command_exists redis-cli; then
        sleep 2  # Give Redis time to start
        if redis-cli ping > /dev/null 2>&1; then
            print_status "Redis installed and running successfully"
        else
            print_warning "Redis installed but not responding to ping"
        fi
    else
        print_error "Redis installation failed"
        exit 1
    fi
}

# Install Node.js dependencies
setup_node_dependencies() {
    print_info "Setting up Node.js dependencies..."
    
    if [ ! -f "package.json" ]; then
        print_error "package.json not found. Please run this script from the project root."
        exit 1
    fi
    
    if [ ! -d "node_modules" ]; then
        print_info "Installing npm packages..."
        npm install
    else
        print_info "Checking for missing packages..."
        npm install
    fi
    
    print_status "Node.js dependencies setup complete"
}

# Setup directories
setup_directories() {
    print_info "Setting up required directories..."
    
    directories=(
        "public/uploads"
        "public/uploads/thumbnails" 
        "temp"
        "temp/audio"
    )
    
    for dir in "${directories[@]}"; do
        if [ ! -d "$dir" ]; then
            mkdir -p "$dir"
            print_status "Created directory: $dir"
        else
            print_status "Directory exists: $dir"
        fi
    done
}

# Setup environment file
setup_environment() {
    print_info "Setting up environment configuration..."
    
    if [ ! -f ".env.local" ]; then
        print_info "Creating .env.local template..."
        cat > .env.local << 'EOF'
# OpenAI API Configuration
OPENAI_API_KEY=your-openai-api-key-here

# Database Configuration
DATABASE_URL="file:./dev.db"

# Redis Configuration (optional, defaults shown)
# REDIS_HOST=localhost
# REDIS_PORT=6379
# REDIS_PASSWORD=

# NextAuth Configuration
NEXTAUTH_SECRET=your-nextauth-secret-here
NEXTAUTH_URL=http://localhost:3000

# FFmpeg Configuration (optional)
# FFMPEG_PATH=/usr/local/bin/ffmpeg
# FFPROBE_PATH=/usr/local/bin/ffprobe
EOF
        print_status "Created .env.local template"
        print_warning "Please edit .env.local and add your OpenAI API key"
    else
        print_status ".env.local already exists"
    fi
}

# Main setup function
main() {
    print_info "Starting automated setup..."
    echo ""
    
    # Setup Homebrew first on macOS
    setup_homebrew
    
    # Install system dependencies
    setup_ffmpeg
    echo ""
    
    setup_redis
    echo ""
    
    # Setup Node.js project
    setup_node_dependencies
    echo ""
    
    setup_directories
    echo ""
    
    setup_environment
    echo ""
    
    print_status "Setup completed successfully!"
    echo ""
    
    print_info "Next steps:"
    echo "1. Edit .env.local and add your OpenAI API key"
    echo "2. Run the verification script: node test-ffmpeg.js"
    echo "3. Start the development server: npm run dev"
    echo ""
    
    print_info "To test your setup, run:"
    echo "  node test-ffmpeg.js"
}

# Run main setup
main