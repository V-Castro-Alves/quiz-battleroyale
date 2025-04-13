# Use official Node.js LTS version
FROM node:18

# Create app directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the app
COPY . .

# Expose the port your app runs on (adjust if not 3000)
EXPOSE 3000

# Start the app
CMD ["npm", "start"]
