# Use specific version for reproducibility (Alpine is smaller/safer)
FROM node:18-alpine

# Set working directory inside the container
WORKDIR /app

# Copy package files first (optimizes Docker cache for npm install)
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on
EXPOSE 3001

# Define environment variable for production
ENV NODE_ENV=production

# Command to run the application
CMD ["node", "server.js"]
