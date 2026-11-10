# STEP 1: Pin an exact, unchangeable base image digest
FROM ubuntu@sha256:3131b4cc82a783df6c9df078f86e01819a13594b865c2cad47bd1bca2b7063bb

# STEP 2: Configure for reproducibility
    
# Force a fixed, static timestamp for file creation logs inside the container layers
# This eliminates time-variance in compilation, ensuring reproducible layer hashes

ARG SOURCE_DATE_EPOCH=0
ENV SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}

ENV DEBIAN_FRONTEND=noninteractive 

# Force Playwright to use a shared global directory rather than a user home folder
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Hardcode the absolute package repository snapshot timestamp
RUN echo 'APT::Snapshot "20260720T120000Z";' > /etc/apt/apt.conf.d/50snapshot

# STEP 3: Install base packages
RUN echo 'Acquire::https::snapshot.ubuntu.com::Verify-Peer "false";' > /etc/apt/apt.conf.d/80snapshot-noverify \
    && apt clean && apt update \
    && apt install -y ca-certificates \
    && rm /etc/apt/apt.conf.d/80snapshot-noverify \
    && apt clean && apt update \
    && apt install -y curl gpg ffmpeg tcpdump bind9-dnsutils iproute2 python3

# STEP 4: Install Immutable, Pinned Google Cloud CLI Tarball
RUN curl -fsO https://storage.googleapis.com/cloud-sdk-release/google-cloud-cli-584.0.0-linux-x86_64.tar.gz \
    && echo "02f0a54a1c5f9e582c568cd8da8258e22275b8ab033532fa03fd46bd9f7a3398 google-cloud-cli-584.0.0-linux-x86_64.tar.gz" | sha256sum --check - \
    && tar -xzf google-cloud-cli-584.0.0-linux-x86_64.tar.gz -C /usr/local --strip-components=1 \
    && /usr/local/bin/gcloud config set component_manager/disable_update_check true \
    && rm google-cloud-cli-584.0.0-linux-x86_64.tar.gz

# Nodejs
RUN mkdir -m 700 -p ~/.gnupg \
    && gpg --keyserver hkps://keys.openpgp.org --recv-keys 5BE8A3F6C8A5C01D106C0AD820B1A390B168D356 \
    && curl -fsO  https://nodejs.org/dist/v24.15.0/node-v24.15.0-linux-x64.tar.gz \
    && echo "44836872d9aec49f1e6b52a9a922872db9a2b02d235a616a5681b6a85fec8d89  node-v24.15.0-linux-x64.tar.gz" | sha256sum --check - \
    && curl -fsO https://nodejs.org/dist/v24.15.0/SHASUMS256.txt.asc && (gpg --decrypt SHASUMS256.txt.asc > SHASUMS256.txt && sha256sum --check SHASUMS256.txt --ignore-missing) || { echo "Security Error: Checksum mismatch!"; exit 1; } \
    && mkdir -p /tmp/node-extract \
    && tar -xzf node-v24.15.0-linux-x64.tar.gz -C /tmp/node-extract --strip-components=1 \
    && cp -R /tmp/node-extract/bin/* /usr/local/bin/ \
    && cp -R /tmp/node-extract/lib/* /usr/local/lib/ \
    && cp -R /tmp/node-extract/share/* /usr/local/share/ \
    && cp -R /tmp/node-extract/include/* /usr/local/include/ 

# STEP 4: Grant specific network tracking capabilities to the binary
RUN setcap cap_net_raw,cap_net_admin=ep /usr/bin/tcpdump

# STEP 5: Create the isolated non-root system users
RUN groupadd -g 10001 forensic_group && \
    useradd -u 10001 -g forensic_group -m -s /bin/sh forensic_user

# STEP 4: Establish the isolated forensic workspace
WORKDIR /forensic_scraper

# Copy EVERYTHING from local project folder into the current WORKDIR (/forensic_scraper)
COPY . .

RUN npm ci \
    && npx playwright install --with-deps chromium \
    && npm run build

RUN chown -R forensic_user:forensic_group /forensic_scraper \
    && chown -R forensic_user:forensic_group /ms-playwright \
    && chmod -R 700 /ms-playwright \
    && chmod -R 700 /forensic_scraper

# Drop root execution privileges down to our isolated user account
USER forensic_user

CMD ["npm", "run", "start"]
