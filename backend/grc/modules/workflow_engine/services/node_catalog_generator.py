"""
Node catalog generator - converts platform-capabilities.json into workflow nodes
"""

import json
from pathlib import Path
from typing import Dict, List, Any
from datetime import datetime

from ..node_types import (
    NodeDefinition, NodeCatalog, NodeType, NodeCategory, ActionType,
    CONTROL_FLOW_NODES, NOTIFICATION_NODES
)


# Icon mapping for action types
ACTION_ICONS = {
    "create": "➕",
    "read": "👁",
    "update": "✏️",
    "delete": "🗑️",
    "assign": "👥",
    "approve": "✅",
    "reject": "❌",
    "upload": "📤",
    "export": "📥",
    "trigger": "⚡"
}

# Color mapping for action types
ACTION_COLORS = {
    "create": "#10B981",
    "read": "#3B82F6",
    "update": "#F59E0B",
    "delete": "#EF4444",
    "assign": "#8B5CF6",
    "approve": "#10B981",
    "reject": "#EF4444",
    "upload": "#06B6D4",
    "export": "#6B7280",
    "trigger": "#F59E0B"
}

# Module colors for visual grouping
MODULE_COLORS = {
    "Administration": "#6B7280",
    "Governance": "#8B5CF6",
    "Compliance": "#3B82F6",
    "Risk Management": "#EF4444",
    "Evidence": "#10B981",
    "Assets": "#06B6D4",
    "Auditor Portal": "#F59E0B",
    "Vulnerability Management": "#EC4899",
    "Workflow Engine": "#6366F1"
}


class NodeCatalogGenerator:
    """Generates workflow node catalog from platform capabilities"""
    
    def __init__(self, capabilities_path: str = None):
        if capabilities_path is None:
            # Default path relative to backend
            root_dir = Path(__file__).parent.parent.parent.parent.parent
            capabilities_path = root_dir / "platform-capabilities.json"
        
        self.capabilities_path = Path(capabilities_path)
        self.capabilities = self._load_capabilities()
    
    def _load_capabilities(self) -> Dict[str, Any]:
        """Load platform capabilities from JSON"""
        with open(self.capabilities_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def generate_catalog(self) -> NodeCatalog:
        """Generate complete node catalog"""
        catalog = NodeCatalog(
            version="2.0.0",
            generated_at=datetime.utcnow().isoformat(),
            triggers=[self._create_trigger_node()],
            actions={},
            controls=CONTROL_FLOW_NODES.copy(),
            notifications=NOTIFICATION_NODES.copy()
        )
        
        # Generate action nodes from capabilities
        for module_data in self.capabilities.get("modules", []):
            module_name = module_data["module"]
            module_nodes = []
            
            for submodule_data in module_data.get("submodules", []):
                submodule_name = submodule_data["name"]
                
                # Process direct functionalities
                for func in submodule_data.get("functionalities", []):
                    node = self._create_action_node(module_name, submodule_name, func)
                    module_nodes.append(node)
                
                # Process nested functionalities
                for nested in submodule_data.get("nested", []):
                    nested_submodule = nested["name"]
                    for func in nested.get("functionalities", []):
                        node = self._create_action_node(
                            module_name, 
                            f"{submodule_name} > {nested_submodule}", 
                            func
                        )
                        module_nodes.append(node)
            
            if module_nodes:
                catalog.actions[module_name] = module_nodes
        
        return catalog
    
    def _create_trigger_node(self) -> NodeDefinition:
        """Create the workflow start trigger node"""
        return NodeDefinition(
            node_id="trigger.workflow_start",
            node_type=NodeType.TRIGGER_START,
            category=NodeCategory.TRIGGER,
            display_name="Workflow Start",
            description="Triggers when a specific event occurs in the platform",
            icon="▶️",
            color="#10B981",
            config_schema={
                "type": "object",
                "properties": {
                    "event_name": {
                        "type": "string",
                        "description": "Event that triggers this workflow"
                    },
                    "conditions": {
                        "type": "object",
                        "description": "Optional conditions to filter events"
                    }
                },
                "required": ["event_name"]
            },
            default_config={
                "event_name": "",
                "conditions": {}
            },
            max_inputs=0,  # Start node has no inputs
            required_inputs=0
        )
    
    def _create_action_node(
        self, 
        module: str, 
        submodule: str, 
        functionality: Dict[str, Any]
    ) -> NodeDefinition:
        """Create an action node from a functionality"""
        action_type = functionality["action"]
        func_name = functionality["name"]
        endpoint = functionality["endpoint"]
        
        # Generate unique node ID
        node_id = f"action.{module.lower().replace(' ', '_')}.{submodule.lower().replace(' ', '_').replace(' > ', '.')}.{action_type}.{self._slugify(func_name)}"
        
        # Determine node type based on action
        node_type_map = {
            "create": NodeType.ACTION_CREATE,
            "read": NodeType.ACTION_READ,
            "update": NodeType.ACTION_UPDATE,
            "delete": NodeType.ACTION_DELETE,
            "assign": NodeType.ACTION_ASSIGN,
            "approve": NodeType.ACTION_APPROVE,
            "reject": NodeType.ACTION_REJECT,
            "upload": NodeType.ACTION_UPLOAD,
            "export": NodeType.ACTION_EXPORT,
            "trigger": NodeType.ACTION_TRIGGER
        }
        
        node_type = node_type_map.get(action_type, NodeType.ACTION_TRIGGER)
        
        # Create configuration schema
        config_schema = {
            "type": "object",
            "properties": {
                "param_mapping": {
                    "type": "object",
                    "description": "Map workflow context variables to endpoint parameters"
                },
                "payload_template": {
                    "type": "object",
                    "description": "Template for the request payload"
                },
                "store_response_as": {
                    "type": "string",
                    "description": "Variable name to store the response in workflow context"
                }
            }
        }
        
        default_config = {
            "module": module,
            "submodule": submodule,
            "action_type": action_type,
            "functionality_name": func_name,
            "endpoint": endpoint,
            "param_mapping": {},
            "payload_template": {}
        }
        
        # Determine if this is a terminal node
        is_terminal = action_type in ["delete", "reject"]
        
        return NodeDefinition(
            node_id=node_id,
            node_type=node_type,
            category=NodeCategory.ACTION,
            display_name=func_name,
            description=f"{action_type.capitalize()} action in {module} > {submodule}",
            icon=ACTION_ICONS.get(action_type, "⚙"),
            color=MODULE_COLORS.get(module, "#6B7280"),
            module=module,
            submodule=submodule,
            config_schema=config_schema,
            default_config=default_config,
            max_outputs=1,
            is_terminal=is_terminal
        )
    
    def _slugify(self, text: str) -> str:
        """Convert text to slug format"""
        return text.lower().replace(" ", "_").replace("/", "_").replace("-", "_")
    
    def export_catalog_json(self, output_path: str = None) -> str:
        """Export catalog to JSON file"""
        catalog = self.generate_catalog()
        
        if output_path is None:
            output_path = self.capabilities_path.parent / "workflow-node-catalog.json"
        
        catalog_dict = catalog.model_dump(mode='json')
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(catalog_dict, f, indent=2, ensure_ascii=False)
        
        return str(output_path)
    
    def get_modules(self) -> List[str]:
        """Get list of all modules"""
        return [m["module"] for m in self.capabilities.get("modules", [])]
    
    def get_action_types(self) -> List[str]:
        """Get list of all action types"""
        return self.capabilities.get("notes", {}).get("action_types", [])


# Singleton instance
_catalog_generator = None

def get_catalog_generator() -> NodeCatalogGenerator:
    """Get or create catalog generator instance"""
    global _catalog_generator
    if _catalog_generator is None:
        _catalog_generator = NodeCatalogGenerator()
    return _catalog_generator


def generate_node_catalog() -> NodeCatalog:
    """Generate and return the complete node catalog"""
    generator = get_catalog_generator()
    return generator.generate_catalog()
