# Use the official lightweight Node.js 16 image.
# https://hub.docker.com/_/node
FROM node:18.13

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    libsqlite3-dev \
    build-essential \
    && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y git

# Create and change to the app directory.
WORKDIR /usr/src/app

# Copy application dependency manifests to the container image.
# A wildcard is used to ensure copying both package.json AND package-lock.json (when available).
# Copying this first prevents re-running npm install on every code change.
COPY package*.json ./

# Copy patches to the container image.
COPY patches ./patches

# Install production dependencies.
# If you add a package-lock.json, speed your build by switching to 'npm ci'.
# RUN npm ci --only=production
RUN npm install --python=/usr/bin/python3

# Copy local code to the container image.
COPY . ./

RUN npm run build

# Run the web service on container startup.
CMD [ "npm", "start" ]
