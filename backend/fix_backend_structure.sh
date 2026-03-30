#!/bin/bash

# 1. Move backend/old contents to the root /old and remove the redundant folder
if [ -d "backend/old" ]; then
    echo "Moving backend/old to root old/backend_legacy..."
    mkdir -p old/backend_legacy
    mv backend/old/* old/backend_legacy/
    rmdir backend/old
fi

# 2. Create the Services and Schemas structure if not present
touch backend/services.py
touch backend/schemas.py

# 3. Consolidate environment variables
if [ ! -f ".env" ]; then
    echo "DATABASE_URL=postgresql://user:password@localhost/dbname" > .env
    echo "Created template .env file. Update this with your actual DB credentials."
fi

echo "Backend structure updated. Ready for code refactoring."
