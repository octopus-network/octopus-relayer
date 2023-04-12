FROM node:16-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create and change to the app directory.
WORKDIR /app

# Copy package.json & package-lock.json
COPY package*.json ./

# Install production dependencies.
RUN npm install --only=production

# Copy local code to the container image.
COPY . ./

# Compile TypeScript codes
RUN npm run build

# Run the icp-sub on container startup.
CMD [ "npm", "run", "icp-sub"]