import React from 'react';
import { Typography } from '@mui/material';

interface LocationDisplayProps {
  folder: chrome.bookmarks.BookmarkTreeNode;
}

export default function LocationDisplay({ folder }: LocationDisplayProps) {
  const [parentName, setParentName] = React.useState<string>('Bookmarks Bar');

  React.useEffect(() => {
    const loadParentName = async () => {
      if (folder.parentId) {
        try {
          const parent = await chrome.bookmarks.get(folder.parentId);
          setParentName(parent[0].title);
        } catch (error) {
          console.error('Failed to load parent folder name:', error);
          setParentName('Unknown Location');
        }
      }
    };
    loadParentName();
  }, [folder.parentId]);

  return (
    <Typography variant="body2" sx={{ mb: 1 }}>
      Location: "Tab Group Bookmarks" (inside {folder.title})
    </Typography>
  );
}
