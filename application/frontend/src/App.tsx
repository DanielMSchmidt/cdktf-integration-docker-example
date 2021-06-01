import React from "react";
import "./App.css";
import { usePosts } from "./api";
import { Post } from "./Post";
import { CreatePostModal } from "./CreatePostModal";

function App() {
  const [isModalOpen, setModalOpen] = React.useState(false);
  const openPostModal = () => setModalOpen(true);
  const closeModal = () => setModalOpen(false);
  const { posts, error } = usePosts();

  if (error) {
    return <p>Error fetching posts: {JSON.stringify(error)}</p>;
  }

  return (
    <div className="background">
      <div>
        <a href="#/" className="post-modal-trigger" onClick={openPostModal}>
          Post new Item
        </a>
      </div>
      <div className="post-list">
        {posts.map((post) => (
          <Post key={post.id} {...post} />
        ))}
      </div>
      <CreatePostModal isModalOpen={isModalOpen} closeModal={closeModal} />
    </div>
  );
}

export default App;
