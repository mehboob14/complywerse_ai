"""Add generated_phases column to CertificationJourney table"""
from sqlalchemy import create_engine, text

# Connect to database
engine = create_engine('sqlite:///grc_app.db')

try:
    with engine.connect() as conn:
        # Add generated_phases column
        conn.execute(text('''
            ALTER TABLE grc_certification_journeys 
            ADD COLUMN generated_phases TEXT
        '''))
        conn.commit()
        print('✓ Added generated_phases column to CertificationJourney')
        
        print('\n✓ Database schema updated successfully!')
        
except Exception as e:
    if 'duplicate column name' in str(e).lower():
        print('⚠ Column already exists, skipping...')
    else:
        print(f'✗ Error: {e}')
