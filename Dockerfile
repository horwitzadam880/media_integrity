# STEP 1: Pin an exact, unchangeable base image digest
FROM ubuntu@sha256:3131b4cc82a783df6c9df078f86e01819a13594b865c2cad47bd1bca2b7063bb

# STEP 2: Configure for reproducibility
    
# Force a fixed, static timestamp for file creation logs inside the container layers
# This eliminates time-variance in compilation, ensuring reproducible layer hashes

# ENV SOURCE_DATE_EPOCH=1719878400
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
    && apt install -y curl gpg ffmpeg tcpdump bind9-dnsutils iproute2

# Google Cloud 
RUN curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | tee -a /etc/apt/sources.list.d/google-cloud-sdk.list \
    && apt-get update \
    && apt-get install -y google-cloud-cli 

# Nodejs
RUN mkdir -m 700 -p ~/.gnupg \
    && gpg --keyserver hkps://keys.openpgp.org --recv-keys 5BE8A3F6C8A5C01D106C0AD820B1A390B168D356 \
    && curl -fsO  https://nodejs.org/dist/v24.15.0/node-v24.15.0-linux-x64.tar.gz \
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
    && chown -R forensic_user:forensic_group /ms-playwright

# Drop root execution privileges down to our isolated user account
USER forensic_user

CMD ["npm", "run", "start"]
