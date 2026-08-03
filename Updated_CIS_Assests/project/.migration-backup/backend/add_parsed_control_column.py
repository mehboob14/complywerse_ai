"""Add parsed_control_id column to CommonControlGroupMapping table"""
from sqlalchemy import create_engine, text

# Connect to database
engine = create_engine('sqlite:///grc_app.db')

try:
    with engine.connect() as conn:
        # Add parsed_control_id column
        conn.execute(text('''
            ALTER TABLE grc_common_control_group_mappings 
            ADD COLUMN parsed_control_id INTEGER
        '''))
        conn.commit()
        print('✓ Added parsed_control_id column')
        
        # Create index
        conn.execute(text('''
            CREATE INDEX IF NOT EXISTS ix_common_group_mapping_parsed 
            ON grc_common_control_group_mappings (group_id, parsed_control_id)
        '''))
        conn.commit()
        print('✓ Created index on parsed_control_id')
        
        print('\n✓ Database schema updated successfully!')
        
except Exception as e:
    if 'duplicate column name' in str(e).lower():
        print('⚠ Column already exists, skipping...')
    else:
        print(f'✗ Error: {e}')
