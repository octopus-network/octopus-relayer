# Use the official lightweight Node.js 16 image.
# https://hub.docker.com/_/node
FROM node:16-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    libsqlite3-dev \
    build-essential \
    && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN apt-get install -y git

# Create and change to the app directory.
WORKDIR /usr/src/app

# Copy application dependency manifests to the container image.
# A wildcard is used to ensure copying both package.json AND package-lock.json (when available).
# Copying this first prevents re-running npm install on every code change.
COPY package*.json ./

# Install production dependencies.
# If you add a package-lock.json, speed your build by switching to 'npm ci'.
# RUN npm ci --only=production
RUN npm install --only=production --python=/usr/bin/python3

# Copy local code to the container image.
COPY . ./

RUN npm run build

# Run the web service on container startup.
CMD [ "npm", "start" ]
