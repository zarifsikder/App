# ============================================
# Wevlo Android Builder - Docker Image
# ============================================
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV ANDROID_HOME=/opt/android-sdk
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV PATH=$PATH:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/build-tools/34.0.0

# প্রয়োজনীয় সফটওয়্যার ইনস্টল
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    unzip \
    git \
    openjdk-17-jdk \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Android SDK Command Line Tools ডাউনলোড
RUN mkdir -p $ANDROID_SDK_ROOT/cmdline-tools && \
    cd $ANDROID_SDK_ROOT/cmdline-tools && \
    wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip && \
    unzip -q commandlinetools-linux-*.zip && \
    mv cmdline-tools latest && \
    rm commandlinetools-linux-*.zip

# Android SDK Licenses অ্যাকসেপ্ট + প্রয়োজনীয় প্যাকেজ ইনস্টল
RUN yes | sdkmanager --licenses > /dev/null 2>&1 || true
RUN sdkmanager "platform-tools" \
    "platforms;android-34" \
    "build-tools;34.0.0" \
    "cmdline-tools;latest"

# Node.js অ্যাপ সেটআপ
WORKDIR /app
COPY package*.json ./
RUN npm install --production

COPY . .

# ডিরেক্টরি তৈরি
RUN mkdir -p /app/apks /app/tmp /app/templates

EXPOSE 3000

CMD ["node", "server.js"]
